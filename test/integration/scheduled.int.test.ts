import { randomUUID } from 'node:crypto';
import { addDays, createLogger, EsbClient, runWithContext, signInternalPrincipal, todayIn, type Principal } from '@atracciones/platform';
import { createMsBookingService, readMsBookingConfig } from '../../apps/services/ms-booking/src';
import { createMsInventoryService, readMsInventoryConfig } from '../../apps/services/ms-inventory/src';
import { createMsOrderService, readMsOrderConfig } from '../../apps/services/ms-order/src';
import { OrderRepository } from '../../apps/services/ms-order/src/persistence/order-repository';
import { EffectiveTariffsJob } from '../../apps/services/ms-pricing/src/events/effective-tariffs-job';
import { PricingRepository } from '../../apps/services/ms-pricing/src/persistence/pricing-repository';
import { PaymentRepository } from '../../apps/services/ms-payment/src/persistence/payment-repository';
import { ATTRACTION, CUSTOMER, OTHER_ATTRACTION, seedV3, type SeedV3 } from '../fixtures/v3/seed';
import { SECRETS, startStack, type Stack } from '../support/stack';

/** Ejecuta una vuelta de un proceso programado sin esperar su temporizador (el método es privado solo en TypeScript). */
/** Atracción sin turnos previos para el generador. */
const NEW_ATTRACTION = 'NUEVAatracc1';

const runOnce = (job: unknown, method = 'run', ...args: unknown[]) => (job as Record<string, (...a: unknown[]) => Promise<void>>)[method](...args);

describe('Procesos programados con su base', () => {
  let stack: Stack;
  let seed: SeedV3;
  let esb: EsbClient;
  let socio: Principal;
  const logger = createLogger('pruebas');
  const env = () => ({ INTERNAL_TOKEN_SECRET: SECRETS.internal, SERVICE_TOKEN: SECRETS.service, VOUCHER_SECRET: SECRETS.voucher, ESB_URL: stack.esbUrl, BOOKING_SYNC_ENABLED: 'false' }) as NodeJS.ProcessEnv;
  const q = (service: keyof Stack['db'], sql: string, params: unknown[] = []) => stack.db[service]!.dataSource.query(sql, params);
  const buy = async () => runWithContext({ correlationId: 'c', principalToken: await signInternalPrincipal(socio, SECRETS.internal, 600) }, () =>
    esb.call<Record<string, string>>('booking', 'createReservation', {
      idempotency_key: randomUUID(), attraction_id: ATTRACTION, slot_id: seed.slots.holgado, date: seed.date, time: seed.times.holgado, adult_count: 2, customer: CUSTOMER, payment_method: { method: 'CREDIT_CARD' },
    }, { timeoutMs: 20_000 }));
  const seatsLeft = async (slot: string) => Number((await q('ms-inventory', `SELECT dis_cupo_total - dis_cupo_reservado AS n FROM disponibilidad WHERE dis_slot_codigo = $1`, [slot]))[0].n);
  const state = async (uuid: string) => (await q('ms-booking', `SELECT e.est_codigo FROM reserva r JOIN estado e ON e.est_id = r.est_id WHERE r.res_uuid = $1`, [uuid]))[0].est_codigo;
  const estado = (codigo: string) => `(SELECT est_id FROM estado WHERE est_codigo = '${codigo}')`;

  /** Turno de hace 2 días (no se puede generar hacia atrás): se inserta y la reserva pasa a apuntarle. */
  async function moveToPastSlot(uuid: string): Promise<void> {
    const past = addDays(todayIn(), -2);
    const [{ hor_id: horId }] = await q('ms-inventory', `SELECT hor_id FROM horario WHERE atr_codigo = $1 AND hor_hora = '10:30:00'`, [ATTRACTION]);
    const [slot] = await q('ms-inventory',
      `INSERT INTO disponibilidad (atr_codigo, hor_id, dis_fecha, dis_slot_codigo, dis_cupo_total) VALUES ($1, $2, $3::date, $4, 20)
       ON CONFLICT DO NOTHING RETURNING dis_id`, [ATTRACTION, horId, past, `slot-${past.replace(/-/g, '')}-1030`]);
    const disId = slot?.dis_id ?? (await q('ms-inventory', `SELECT dis_id FROM disponibilidad WHERE dis_slot_codigo = $1`, [`slot-${past.replace(/-/g, '')}-1030`]))[0].dis_id;
    await q('ms-booking', `UPDATE reserva SET dis_id = $2 WHERE res_uuid = $1`, [uuid, disId]);
  }

  beforeAll(async () => {
    stack = await startStack();
    seed = await seedV3(stack);
    esb = new EsbClient(stack.esbUrl, 25_000, SECRETS.service);
    socio = { tipo: 'API_CLIENTE', id: String(seed.partnerId), scopes: [], nombre: 'Booking' };
  }, 120_000);
  afterAll(async () => {
    await stack?.close();
  });

  // ---- lifecycle (ms-booking) ----
  it('lifecycle · PENDING sin pagar de hace más de 30 min → EXPIRED, orden cancelada y cupos devueltos en ms-inventory', async () => {
    const res = await buy();
    const before = await seatsLeft(seed.slots.holgado);
    await q('ms-booking', `UPDATE reserva SET est_id = ${estado('PENDING')}, res_confirmado_en = NULL, res_creado_en = now() - interval '1 hour' WHERE res_uuid = $1`, [res.reservation_id]);
    await q('ms-order', `UPDATE orden SET est_id = ${estado('CREADA')} WHERE ord_numero = $1`, [res.external_order_id]);
    const { lifecycle } = createMsBookingService(readMsBookingConfig(env()), stack.db['ms-booking']!.dataSource, { logger });
    await runOnce(lifecycle);
    expect(await state(res.reservation_id)).toBe('EXPIRED');
    expect(await seatsLeft(seed.slots.holgado)).toBe(before + 2);
    const [order] = await q('ms-order', `SELECT e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE o.ord_numero = $1`, [res.external_order_id]);
    expect(order.est_codigo).toBe('CANCELADA');
  });

  it('lifecycle · CHECKED_IN con turno pasado → COMPLETED; CONFIRMED sin check-in con turno pasado → EXPIRED', async () => {
    const used = await buy();
    const noShow = await buy();
    await runWithContext({ correlationId: 'c', principalToken: await signInternalPrincipal(socio, SECRETS.internal, 600) }, () =>
      esb.call('booking', 'checkIn', { idempotency_key: randomUUID(), id: used.reservation_id, documento_identidad: CUSTOMER.document_id }));
    await moveToPastSlot(used.reservation_id);
    await moveToPastSlot(noShow.reservation_id);
    const { lifecycle } = createMsBookingService(readMsBookingConfig(env()), stack.db['ms-booking']!.dataSource, { logger });
    await runOnce(lifecycle);
    expect(await state(used.reservation_id)).toBe('COMPLETED');
    expect(await state(noShow.reservation_id)).toBe('EXPIRED');
  });

  it('lifecycle · la expiración de una PENDING emite RESERVA_CANCELADA y STOCK_ACTUALIZADO con los cupos de Inventory', async () => {
    const res = await buy();
    await q('ms-booking', `UPDATE reserva SET est_id = ${estado('PENDING')}, res_confirmado_en = NULL, res_creado_en = now() - interval '1 hour' WHERE res_uuid = $1`, [res.reservation_id]);
    await q('ms-order', `UPDATE orden SET est_id = ${estado('CREADA')} WHERE ord_numero = $1`, [res.external_order_id]);
    await runOnce(createMsBookingService(readMsBookingConfig(env()), stack.db['ms-booking']!.dataSource, { logger }).lifecycle);
    const events = await q('ms-booking', `SELECT evt_tipo, evt_payload FROM outbox_evento WHERE evt_aggregate_id = $1 ORDER BY evt_id`, [res.reservation_code]);
    expect(events.slice(-2).map((e: { evt_tipo: string }) => e.evt_tipo)).toEqual(['RESERVA_CANCELADA', 'STOCK_ACTUALIZADO']);
    expect(events.at(-1).evt_payload.cupos_disponibles).toBe(await seatsLeft(seed.slots.holgado));
  });

  // ---- stale-orders (ms-order) ----
  it('stale-orders · orden colgada con pago aprobado en ms-payment → PAGADA; sin pago → pagos pendientes cancelados y CANCELADA', async () => {
    const orders = new OrderRepository(stack.db['ms-order']!.dataSource);
    const order = (n: number) => orders.create({ owner: { usuId: 3, claId: null }, caiId: null, mpaId: 1, atrId: 7, nombre: 'Tour', moneda: 'USD', observaciones: null, totals: { subtotal: n, descuento: 0, iva: 0, total: n }, lines: [{ type: 'ADULT', cantidad: 1, unitPrice: n, subtotal: n }], coupon: null });
    const paid = await order(10);
    const unpaid = await order(20);
    await q('ms-order', `UPDATE orden SET ord_creado_en = now() - interval '1 hour' WHERE ord_id = ANY($1::bigint[])`, [[paid.ord_id, unpaid.ord_id]]);
    const payments = new PaymentRepository(stack.db['ms-payment']!.dataSource);
    await payments.create({ numero: `PAG-${paid.ord_numero}-1`, ord_id: Number(paid.ord_id), metodo: 'CREDIT_CARD', monto: 10, moneda: 'USD', canal: 'B2B', tarjeta: null } as never);
    await payments.create({ numero: `PAG-${unpaid.ord_numero}-1`, ord_id: Number(unpaid.ord_id), metodo: 'TRANSFER', monto: 20, moneda: 'USD', canal: 'WEB', tarjeta: null } as never);
    const { staleOrders } = createMsOrderService(readMsOrderConfig(env()), stack.db['ms-order']!.dataSource, { logger });
    await runOnce(staleOrders);
    expect((await orders.findById(Number(paid.ord_id)))?.est_codigo).toBe('PAGADA');
    expect((await orders.findById(Number(unpaid.ord_id)))?.est_codigo).toBe('CANCELADA');
    const [pago] = await q('ms-payment', `SELECT e.est_codigo FROM pago p JOIN estado e ON e.est_id = p.est_id WHERE p.pag_numero = $1`, [`PAG-${unpaid.ord_numero}-1`]);
    expect(pago.est_codigo).toBe('FALLIDO');
  });

  it('stale-orders · borra las claves de idempotencia vencidas', async () => {
    await q('ms-order', `INSERT INTO idempotencia (idem_clave, idem_sujeto_tipo, idem_sujeto, idem_operacion, idem_request_hash, idem_expira_en) VALUES ($1, 'USUARIO', 3, 'CreateOrder', 'H', now() - interval '1 minute')`, [randomUUID()]);
    await runOnce(createMsOrderService(readMsOrderConfig(env()), stack.db['ms-order']!.dataSource, { logger }).staleOrders);
    const [{ n }] = await q('ms-order', `SELECT count(*)::int AS n FROM idempotencia WHERE idem_expira_en < now()`);
    expect(n).toBe(0);
  });

  // ---- slot-generator (ms-inventory) ----
  it('slot-generator · genera turnos hacia adelante (90 días) para un horario nuevo', async () => {
    const { generator } = createMsInventoryService(readMsInventoryConfig(env()), stack.db['ms-inventory']!.dataSource, { logger });
    await q('ms-inventory', `INSERT INTO horario (atr_codigo, hor_hora, hor_cupo) VALUES ($1, '18:30:00', 8)`, [NEW_ATTRACTION]);
    await expect(generator.generate(NEW_ATTRACTION)).resolves.toBe(91);
    const [{ ultimo }] = await q('ms-inventory', `SELECT max(dis_fecha)::text AS ultimo FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id WHERE h.hor_hora = '18:30:00'`);
    expect(ultimo).toBe(addDays(todayIn(), 90));
  });

  it('slot-generator · una segunda ejecución no duplica turnos', async () => {
    const { generator } = createMsInventoryService(readMsInventoryConfig(env()), stack.db['ms-inventory']!.dataSource, { logger });
    await generator.generate();
    const [{ n: before }] = await q('ms-inventory', `SELECT count(*)::int AS n FROM disponibilidad`);
    await expect(generator.generate()).resolves.toBe(0);
    const [{ n: after }] = await q('ms-inventory', `SELECT count(*)::int AS n FROM disponibilidad`);
    expect(after).toBe(before);
  });

  // ---- effective-tariffs-job (ms-pricing) ----
  it('effective-tariffs · la tarifa que entra en vigencia hoy deja TARIFA_ACTUALIZADA con la tabla completa', async () => {
    const pricing = new PricingRepository(stack.db['ms-pricing']!.dataSource);
    // Una tabla que empieza hoy y se escribió sin evento (como una tarifa futura cuando llega su día).
    await q('ms-pricing', `DELETE FROM tarifa WHERE atr_codigo = $1`, [OTHER_ATTRACTION]);
    for (const [tipo, precio] of [['ADULT', 60], ['CHILD', 30], ['SENIOR', 40], ['INFANT', 0]]) {
      await q('ms-pricing', `INSERT INTO tarifa (atr_codigo, tar_tipo, tar_precio, tar_vigente_desde) VALUES ($1, $2, $3, $4::date)`, [OTHER_ATTRACTION, tipo, precio, todayIn()]);
    }
    const before = (await q('ms-pricing', `SELECT count(*)::int AS n FROM outbox WHERE tipo_evento = 'TARIFA_ACTUALIZADA'`))[0].n;
    const job = new EffectiveTariffsJob(pricing, logger);
    await runOnce(job, 'run', 1);
    const events = await q('ms-pricing', `SELECT payload FROM outbox WHERE tipo_evento = 'TARIFA_ACTUALIZADA' ORDER BY creado_en`);
    expect(events.length).toBeGreaterThan(before);
    expect(events.find((e: { payload: { attraction_id: string; current_prices: { adult: number } } }) => e.payload.attraction_id === OTHER_ATTRACTION && e.payload.current_prices.adult === 60)).toBeDefined();
  });

  it('effective-tariffs · una tarifa futura no se publica antes de su día', async () => {
    const pricing = new PricingRepository(stack.db['ms-pricing']!.dataSource);
    const future = addDays(todayIn(), 5);
    await pricing.setPriceTable({ codigo: ATTRACTION, validFrom: future, prices: { ADULT: 99, CHILD: 50, SENIOR: 70, INFANT: 0 } }, todayIn());
    await runOnce(new EffectiveTariffsJob(pricing, logger), 'run', 1);
    const events = await q('ms-pricing', `SELECT payload FROM outbox WHERE tipo_evento = 'TARIFA_ACTUALIZADA'`);
    expect(events.some((e: { payload: { current_prices: { adult: number } } }) => e.payload.current_prices.adult === 99)).toBe(false);
  });
});
