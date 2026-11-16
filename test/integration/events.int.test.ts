import { randomUUID } from 'node:crypto';
import { EsbClient, runWithContext, signInternalPrincipal, todayIn, type EventBus, type EventEnvelope, type Principal } from '@atracciones/platform';
import { PaymentRepository } from '../../apps/services/ms-payment/src/persistence/payment-repository';
import { PricingRepository } from '../../apps/services/ms-pricing/src/persistence/pricing-repository';
import { RefundRepository } from '../../apps/services/ms-refund/src/persistence/refund-repository';
import { ReviewRepository } from '../../apps/services/ms-review/src/persistence/review-repository';
import { ATTRACTION, CUSTOMER, OTHER_ATTRACTION, seedV3, type SeedV3 } from '../fixtures/v3/seed';
import { cleanTestBus, testBus, trackQueue, waitFor } from '../support/bus';
import { SECRETS, startStack, type Stack } from '../support/stack';

/**
 * 4.5 · Eventos productor → RabbitMQ local → consumidor, con los servicios reales. El outbox de cada productor se publica
 * con su relay (`stack.pumpEvents`) y se espera el efecto en la base del consumidor con sondeo, sin esperas fijas.
 */
describe('Eventos: productor → RabbitMQ → consumidor', () => {
  let stack: Stack;
  let seed: SeedV3;
  let esb: EsbClient;
  let bus: EventBus;
  let socio: Principal;

  const q = (service: keyof Stack['db'], sql: string, params: unknown[] = []) => stack.db[service]!.dataSource.query(sql, params);
  const estado = (codigo: string) => `(SELECT est_id FROM estado WHERE est_codigo = '${codigo}')`;
  const reservaState = async (uuid: string) => (await q('ms-booking', `SELECT e.est_codigo FROM reserva r JOIN estado e ON e.est_id = r.est_id WHERE r.res_uuid = $1`, [uuid]))[0].est_codigo;
  const orderState = async (numero: string) => (await q('ms-order', `SELECT e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE o.ord_numero = $1`, [numero]))[0].est_codigo;
  const ordId = async (numero: string) => Number((await q('ms-order', `SELECT ord_id FROM orden WHERE ord_numero = $1`, [numero]))[0].ord_id);
  const seatsLeft = async () => Number((await q('ms-inventory', `SELECT dis_cupo_total - dis_cupo_reservado AS n FROM disponibilidad WHERE dis_slot_codigo = $1`, [seed.slots.holgado]))[0].n);
  const buy = async () => runWithContext({ correlationId: 'c', principalToken: await signInternalPrincipal(socio, SECRETS.internal, 600) }, () =>
    esb.call<Record<string, string>>('booking', 'createReservation', {
      idempotency_key: randomUUID(), attraction_id: ATTRACTION, slot_id: seed.slots.holgado, date: seed.date, time: seed.times.holgado, adult_count: 1, customer: CUSTOMER, payment_method: { method: 'CREDIT_CARD' },
    }, { timeoutMs: 20_000 }));

  /**
   * Compra que queda esperando el pago: reserva PENDING, orden CREADA y su pago PENDIENTE en ms-payment. Primero se
   * procesan los eventos de la compra (la venta B2B ya dejó un PagoAprobado) y luego se devuelven los tres a pendiente.
   */
  async function pendingPurchase(): Promise<{ res: Record<string, string>; pagId: number }> {
    const res = await buy();
    await stack.pumpEvents();
    await q('ms-booking', `UPDATE reserva SET est_id = ${estado('PENDING')}, res_confirmado_en = NULL WHERE res_uuid = $1`, [res.reservation_id]);
    await q('ms-order', `UPDATE orden SET est_id = ${estado('CREADA')} WHERE ord_numero = $1`, [res.external_order_id]);
    // UPDATE … RETURNING con TypeORM devuelve [filas, cantidad].
    const [rows] = await q('ms-payment', `UPDATE pago SET est_id = ${estado('PENDIENTE')}, pag_aprobado_en = NULL WHERE pag_numero = $1 RETURNING pag_id`, [`PAG-${res.external_order_id}-1`]);
    return { res, pagId: Number(rows[0].pag_id) };
  }

  beforeAll(async () => {
    bus = await testBus();
    stack = await startStack({ bus });
    for (const queue of ['ms-booking', 'ms-catalog', 'ms-order']) trackQueue(queue);
    seed = await seedV3(stack);
    await stack.pumpEvents();
    esb = new EsbClient(stack.esbUrl, 25_000, SECRETS.service);
    socio = { tipo: 'API_CLIENTE', id: String(seed.partnerId), scopes: [], nombre: 'Booking' };
  }, 120_000);
  afterAll(async () => {
    await stack?.close();
    await bus?.close();
    await cleanTestBus();
  });

  // ---- Pago aprobado o rechazado: ms-payment → ms-order y ms-booking ----
  it('PagoAprobado confirma la orden (PAGADA) y la reserva (CONFIRMED)', async () => {
    const { res, pagId } = await pendingPurchase();
    await new PaymentRepository(stack.db['ms-payment']!.dataSource).applyResult(pagId, { aprobado: true, referencia: 'R', autorizacion: 'A' });
    await stack.pumpEvents();
    await waitFor(async () => (await orderState(res.external_order_id)) === 'PAGADA' && (await reservaState(res.reservation_id)) === 'CONFIRMED');
  });

  it('PagoRechazado compensa: orden CANCELADA, reserva CANCELLED y cupos devueltos', async () => {
    const { res, pagId } = await pendingPurchase();
    const before = await seatsLeft();
    await new PaymentRepository(stack.db['ms-payment']!.dataSource).applyResult(pagId, { aprobado: false, motivo: 'Fondos insuficientes' });
    await stack.pumpEvents();
    await waitFor(async () => (await orderState(res.external_order_id)) === 'CANCELADA' && (await reservaState(res.reservation_id)) === 'CANCELLED');
    expect(await seatsLeft()).toBe(before + 1);
  });

  it('orden de llegada invertida: un PagoAprobado que llega cuando la compra ya confirmó no cambia nada ni duplica eventos', async () => {
    const res = await buy();
    const count = async () => (await q('ms-booking', `SELECT count(*)::int AS n FROM outbox_evento WHERE evt_aggregate_id = $1 AND evt_tipo = 'RESERVA_CONFIRMADA'`, [res.reservation_code]))[0].n;
    expect(await count()).toBe(1);
    await bus.publish('payment.PagoAprobado', { specversion: '1.0', id: randomUUID(), source: '/servicios/payment', type: 'PagoAprobado', subject: 'x', time: new Date().toISOString(), correlation_id: 'c', data: { ord_id: await ordId(res.external_order_id) } });
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(async () => (await q('ms-order', `SELECT 1 FROM orden WHERE ord_numero = $1`, [res.external_order_id])).length === 1);
    expect(await reservaState(res.reservation_id)).toBe('CONFIRMED');
    expect(await count()).toBe(1);
  });

  // ---- Reembolso emitido: ms-refund → ms-order y ms-booking ----
  it('ReembolsoEmitido total → orden REEMBOLSADA', async () => {
    const res = await buy();
    const id = await ordId(res.external_order_id);
    const [pago] = await q('ms-payment', `SELECT pag_id FROM pago WHERE ord_id = $1`, [id]);
    await new RefundRepository(stack.db['ms-refund']!.dataSource).emit({ id: Number(pago.pag_id), monto: 45 }, { ord_id: id, monto: null, motivo: 'x' }, randomUUID());
    await stack.pumpEvents();
    await waitFor(async () => (await orderState(res.external_order_id)) === 'REEMBOLSADA');
  });

  it('ReembolsoEmitido → la reserva guarda el reembolso_id y el monto', async () => {
    const res = await buy();
    const id = await ordId(res.external_order_id);
    const [pago] = await q('ms-payment', `SELECT pag_id FROM pago WHERE ord_id = $1`, [id]);
    const refund = await new RefundRepository(stack.db['ms-refund']!.dataSource).emit({ id: Number(pago.pag_id), monto: 45 }, { ord_id: id, monto: null, motivo: 'x' }, randomUUID());
    await stack.pumpEvents();
    await waitFor(async () => (await q('ms-booking', `SELECT res_reembolso_id FROM reserva WHERE res_uuid = $1`, [res.reservation_id]))[0].res_reembolso_id === refund!.reembolso_id);
  });

  // ---- Tarifa actualizada: ms-pricing → ms-catalog ----
  it('TARIFA_ACTUALIZADA: la ficha de ms-catalog muestra la tarifa nueva', async () => {
    const today = todayIn();
    await new PricingRepository(stack.db['ms-pricing']!.dataSource).setPriceTable({ codigo: OTHER_ATTRACTION, validFrom: today, prices: { ADULT: 70, CHILD: 35, SENIOR: 49, INFANT: 0 } }, today);
    await stack.pumpEvents();
    await waitFor(async () => (await esb.call<{ price: { adult: number } }>('catalog', 'getAttraction', { id: OTHER_ATTRACTION })).price.adult === 70);
  });

  it('TARIFA_ACTUALIZADA: una tarifa futura no cambia la ficha antes de su día', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await new PricingRepository(stack.db['ms-pricing']!.dataSource).setPriceTable({ codigo: ATTRACTION, validFrom: future, prices: { ADULT: 99, CHILD: 50, SENIOR: 70, INFANT: 0 } }, todayIn());
    await stack.pumpEvents();
    expect((await esb.call<{ price: { adult: number } }>('catalog', 'getAttraction', { id: ATTRACTION })).price.adult).toBe(45);
  });

  // ---- Reseña publicada: ms-review → ms-catalog ----
  it('RESENA_PUBLICADA: promedio y cantidad de valoraciones en la ficha', async () => {
    const [{ atr_id: atrId }] = await q('ms-catalog', `SELECT atr_id FROM atraccion WHERE atr_codigo = $1`, [ATTRACTION]);
    const reviews = new ReviewRepository(stack.db['ms-review']!.dataSource);
    const score = (n: number) => ({ puntuacion: n, limpieza: n, servicio: n, calidad_precio: n, puntualidad: n, comentario: 'ok' });
    await reviews.createForUser(Number(atrId), 1, score(10));
    await reviews.createForUser(Number(atrId), 2, score(8));
    await stack.pumpEvents();
    await waitFor(async () => {
      const ficha = await esb.call<{ rating: { score: number; review_count: number } }>('catalog', 'getAttraction', { id: ATTRACTION });
      return ficha.rating.review_count === 2 && ficha.rating.score === 9;
    });
  });

  it('RESENA_PUBLICADA: el desglose de valoraciones llega a la ficha', async () => {
    const ficha = await esb.call<{ rating: { breakdown: Record<string, number> } }>('catalog', 'getAttraction', { id: ATTRACTION });
    expect(ficha.rating.breakdown).toMatchObject({ limpieza: 9, servicio: 9, calidad_precio: 9, puntualidad: 9 });
  });

  // ---- Eventos de reserva al feed ----
  it('RESERVA_CREADA y RESERVA_CONFIRMADA aparecen en listEvents con la forma OutboxEventItem', async () => {
    const res = await buy();
    const { events } = await runWithContext({ correlationId: 'c', principalToken: await signInternalPrincipal(socio, SECRETS.internal, 600) }, () => esb.call<{ events: Record<string, unknown>[] }>('booking', 'listEvents', { after: 0, limit: 200 }));
    const mine = events.filter((e) => e.aggregate_id === res.reservation_code);
    expect(mine.map((e) => e.event_type)).toEqual(['RESERVA_CREADA', 'STOCK_ACTUALIZADO', 'RESERVA_CONFIRMADA']);
    for (const e of mine) expect(Object.keys(e).sort()).toEqual(['aggregate_id', 'correlation_id', 'event_id', 'event_type', 'payload_json', 'sequence_number', 'source', 'specversion', 'timestamp']);
  });

  it('los eventos de reserva también salen al bus con la clave booking.<tipo>', async () => {
    const seen: string[] = [];
    await bus.subscribe(trackQueue(`feed-${randomUUID().slice(0, 6)}`), ['booking.*'], async (e) => { seen.push(e.type); });
    const res = await buy();
    await stack.pumpEvents();
    await waitFor(() => seen.includes('RESERVA_CONFIRMADA'));
    expect(seen).toEqual(expect.arrayContaining(['RESERVA_CREADA', 'RESERVA_CONFIRMADA']));
    expect(res.status).toBe('CONFIRMED');
  });

  // ---- Reentrega del mismo evento: procesar dos veces no cambia el resultado ----
  describe('reentrega del mismo evento', () => {
    const redeliver = async (key: string, event: EventEnvelope) => {
      await bus.publish(key, event);
      await bus.publish(key, event);
    };
    const envelope = (type: string, data: Record<string, unknown>): EventEnvelope => ({ specversion: '1.0', id: randomUUID(), source: '/x', type, subject: 'x', time: new Date().toISOString(), correlation_id: 'c', data });

    it('ms-order · PagoAprobado repetido: un solo OrdenPagada', async () => {
      const { res } = await pendingPurchase();
      await redeliver('payment.PagoAprobado', envelope('PagoAprobado', { ord_id: await ordId(res.external_order_id) }));
      await waitFor(async () => (await orderState(res.external_order_id)) === 'PAGADA');
      await waitFor(async () => (await reservaState(res.reservation_id)) === 'CONFIRMED');
      const [{ n }] = await q('ms-order', `SELECT count(*)::int AS n FROM outbox WHERE agregado_id = $1 AND tipo_evento = 'OrdenPagada'`, [res.external_order_id]);
      // Uno de la compra original (B2B) y uno solo por las dos entregas repetidas.
      expect(n).toBe(2);
    });

    it('ms-booking · PagoRechazado repetido: los cupos se devuelven una sola vez', async () => {
      const { res } = await pendingPurchase();
      const before = await seatsLeft();
      await redeliver('payment.PagoRechazado', envelope('PagoRechazado', { ord_id: await ordId(res.external_order_id), motivo: 'x' }));
      await waitFor(async () => (await reservaState(res.reservation_id)) === 'CANCELLED');
      await waitFor(async () => (await orderState(res.external_order_id)) === 'CANCELADA');
      expect(await seatsLeft()).toBe(before + 1);
    });

    it('ms-booking · ReembolsoEmitido repetido deja el mismo reembolso', async () => {
      const res = await buy();
      await redeliver('refund.ReembolsoEmitido', envelope('ReembolsoEmitido', { ord_id: await ordId(res.external_order_id), reembolso_id: 'REF-REP-1', monto_acumulado: 10 }));
      await waitFor(async () => (await q('ms-booking', `SELECT res_reembolso_id FROM reserva WHERE res_uuid = $1`, [res.reservation_id]))[0].res_reembolso_id === 'REF-REP-1');
      const [row] = await q('ms-booking', `SELECT res_monto_reembolsado FROM reserva WHERE res_uuid = $1`, [res.reservation_id]);
      expect(Number(row.res_monto_reembolsado)).toBe(10);
    });

    it('ms-catalog · TARIFA_ACTUALIZADA repetida deja los mismos precios', async () => {
      await redeliver('pricing.TARIFA_ACTUALIZADA', envelope('TARIFA_ACTUALIZADA', { attraction_id: OTHER_ATTRACTION, current_prices: { currency: 'USD', adult: 80, child: 40, senior: 56, infant: 0 } }));
      await waitFor(async () => (await esb.call<{ price: { adult: number } }>('catalog', 'getAttraction', { id: OTHER_ATTRACTION })).price.adult === 80);
      expect((await esb.call<{ price: { child: number } }>('catalog', 'getAttraction', { id: OTHER_ATTRACTION })).price.child).toBe(40);
    });

    it('ms-catalog · RESENA_PUBLICADA repetida deja el mismo promedio', async () => {
      const [{ atr_id: atrId }] = await q('ms-catalog', `SELECT atr_id FROM atraccion WHERE atr_codigo = $1`, [OTHER_ATTRACTION]);
      await redeliver('review.RESENA_PUBLICADA', envelope('RESENA_PUBLICADA', { atr_id: Number(atrId), ren_id: 1, promedio: 7.5, limpieza: 7, servicio: 8, calidad_precio: 7, puntualidad: 8, numero_resenas: 4 }));
      await waitFor(async () => (await esb.call<{ rating: { review_count: number } }>('catalog', 'getAttraction', { id: OTHER_ATTRACTION })).rating.review_count === 4);
      expect((await esb.call<{ rating: { score: number } }>('catalog', 'getAttraction', { id: OTHER_ATTRACTION })).rating.score).toBe(7.5);
    });
  });
});
