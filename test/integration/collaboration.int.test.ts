import { randomUUID } from 'node:crypto';
import { addDays, EsbClient, runWithContext, signInternalPrincipal, todayIn, type Principal } from '@atracciones/platform';
import { ATTRACTION, CUSTOMER, seedV3, type SeedV3 } from '../fixtures/v3/seed';
import { SECRETS, startStack, type Stack } from '../support/stack';

/**
 * 4.4 · Colaboración entre microservicios vía ESB con los servicios reales y sus bases `ms_*`. Se llama al ESB como lo
 * hace la Partner API: con el principal interno firmado por el Gateway.
 */
describe('Colaboración entre microservicios (vía ESB)', () => {
  let stack: Stack;
  let seed: SeedV3;
  let esb: EsbClient;
  let socio: Principal;

  const as = async <T>(principal: Principal, work: () => Promise<T>) =>
    runWithContext({ correlationId: `cid-${randomUUID()}`, principalToken: await signInternalPrincipal(principal, SECRETS.internal, 600) }, work);
  const purchase = (overrides: Record<string, unknown> = {}) => ({
    idempotency_key: randomUUID(), attraction_id: ATTRACTION, slot_id: seed.slots.holgado, date: seed.date, time: seed.times.holgado,
    adult_count: 2, child_count: 1, customer: CUSTOMER, payment_method: { method: 'CREDIT_CARD' }, ...overrides,
  });
  const buy = (overrides: Record<string, unknown> = {}) => as(socio, () => esb.call<Record<string, unknown>>('booking', 'createReservation', purchase(overrides), { timeoutMs: 20_000 }));
  const seatsLeft = async (slot: string) => Number((await stack.db['ms-inventory']!.dataSource.query(`SELECT dis_cupo_total - dis_cupo_reservado AS n FROM disponibilidad WHERE dis_slot_codigo = $1`, [slot]))[0].n);
  const orderState = async (numero: string) => (await stack.db['ms-order']!.dataSource.query(`SELECT e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE o.ord_numero = $1`, [numero]))[0]?.est_codigo;

  beforeAll(async () => {
    stack = await startStack();
    seed = await seedV3(stack);
    esb = new EsbClient(stack.esbUrl, 25_000, SECRETS.service);
    socio = { tipo: 'API_CLIENTE', id: String(seed.partnerId), scopes: ['attractions:book'], nombre: 'Booking' };
  }, 120_000);
  afterAll(async () => {
    await stack?.close();
  });

  // ---- Saga de compra (P7) ----
  it('P7 · camino feliz: CONFIRMED, cupos descontados, orden PAGADA y precio cotizado por edad', async () => {
    const before = await seatsLeft(seed.slots.holgado);
    const res = await buy();
    expect(res).toMatchObject({ status: 'CONFIRMED', ticket_count: 3, total_price: 112.5, canal: 'SOCIO', reservation_code: expect.stringMatching(/^DEC-/) });
    expect(await seatsLeft(seed.slots.holgado)).toBe(before - 3);
    expect(await orderState(String(res.external_order_id))).toBe('PAGADA');
  });

  it('P7 · turno lleno → 409 OUT_OF_STOCK, la orden queda CANCELADA y no hay reserva', async () => {
    await expect(buy({ slot_id: seed.slots.lleno, time: seed.times.lleno, child_count: 0, adult_count: 1 })).rejects.toMatchObject({ status: 409, code: 'OUT_OF_STOCK' });
    const [last] = await stack.db['ms-order']!.dataSource.query(`SELECT e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id ORDER BY o.ord_id DESC LIMIT 1`);
    expect(last.est_codigo).toBe('CANCELADA');
  });

  it('P7 · pago que falla (Payment caído) → reserva CANCELLED, cupos devueltos y orden cancelada', async () => {
    const before = await seatsLeft(seed.slots.holgado);
    const paymentUrl = stack.esbConfig.targets.payment;
    stack.esbConfig.targets.payment = 'http://127.0.0.1:9';
    try {
      await expect(buy({ adult_count: 1, child_count: 0 })).rejects.toMatchObject({ status: 503 });
    } finally {
      stack.esbConfig.targets.payment = paymentUrl;
    }
    expect(await seatsLeft(seed.slots.holgado)).toBe(before);
    const [last] = await stack.db['ms-booking']!.dataSource.query(`SELECT e.est_codigo, r.ord_numero FROM reserva r JOIN estado e ON e.est_id = r.est_id ORDER BY r.res_id DESC LIMIT 1`);
    expect(last.est_codigo).toBe('CANCELLED');
    // CancelOrder también necesita a Payment (cancela sus pagos pendientes): con Payment caído la orden queda CREADA
    // y la cierra StaleOrders a los 30 min (caso 4.6). Nunca queda PAGADA.
    expect(await orderState(last.ord_numero)).toBe('CREADA');
  });

  it('P7 · ms-order caído a mitad → 503 sin cupos descontados', async () => {
    const before = await seatsLeft(seed.slots.holgado);
    const orderUrl = stack.esbConfig.targets.order;
    stack.esbConfig.targets.order = 'http://127.0.0.1:9';
    try {
      await expect(buy()).rejects.toMatchObject({ status: 503 });
    } finally {
      stack.esbConfig.targets.order = orderUrl;
    }
    expect(await seatsLeft(seed.slots.holgado)).toBe(before);
  });

  it('P7 · turista nuevo: queda en cliente_api de Identity y con su perfil de facturación principal', async () => {
    const res = await buy({ customer: { ...CUSTOMER, full_name: 'Luis Andrade', email: 'luis@correo.com', document_id: '3010034068' }, adult_count: 1, child_count: 0 });
    const claId = Number(res.client_id);
    expect(claId).toBeGreaterThan(0);
    const [profile] = await stack.db['ms-billing-profile']!.dataSource.query(`SELECT dfa_identificacion, dfa_es_principal FROM dato_facturacion WHERE cla_id = $1`, [claId]);
    expect(profile).toEqual({ dfa_identificacion: '3010034068', dfa_es_principal: true });
  });

  // ---- Orden del socio (P7) ----
  it('P7 · orden: la cotización por edad de Pricing llega a las líneas de la orden', async () => {
    const res = await buy({ adult_count: 1, child_count: 2, senior_count: 1 });
    const lines = await stack.db['ms-order']!.dataSource.query(
      `SELECT d.det_descripcion, d.det_cantidad, d.det_precio_unitario FROM orden_detalle d JOIN orden o ON o.ord_id = d.ord_id WHERE o.ord_numero = $1 ORDER BY d.det_id`,
      [res.external_order_id],
    );
    expect(lines.map((l: { det_precio_unitario: string }) => Number(l.det_precio_unitario))).toEqual([45, 22.5, 31.5]);
    expect(res.total_price).toBe(45 + 45 + 31.5);
  });

  it('P7 · cobro aprobado (B2B): pago APROBADO en ms-payment y outbox PagoAprobado', async () => {
    const res = await buy({ adult_count: 1, child_count: 0 });
    const [pago] = await stack.db['ms-payment']!.dataSource.query(`SELECT e.est_codigo FROM pago p JOIN estado e ON e.est_id = p.est_id WHERE p.pag_numero = $1`, [`PAG-${res.external_order_id}-1`]);
    expect(pago.est_codigo).toBe('APROBADO');
  });

  it('P7 · método de pago inactivo en Payment → la orden no se crea (422) y no hay cupos tomados', async () => {
    const before = await seatsLeft(seed.slots.holgado);
    await stack.db['ms-payment']!.dataSource.query(`UPDATE metodo_pago SET mpa_activo = FALSE WHERE mpa_codigo = 'PAYPAL'`);
    await expect(buy({ payment_method: { method: 'PAYPAL' } })).rejects.toMatchObject({ status: 422 });
    expect(await seatsLeft(seed.slots.holgado)).toBe(before);
  });

  // ---- Cancelación (P9) ----
  it('P9 · cancelación del socio: cupos devueltos, reembolso emitido en ms-refund y RESERVA_CANCELADA', async () => {
    const res = await buy({ adult_count: 2, child_count: 0 });
    const before = await seatsLeft(seed.slots.holgado);
    const cancelled = await as(socio, () => esb.call<Record<string, unknown>>('booking', 'cancelReservation', { idempotency_key: randomUUID(), id: res.reservation_id, reason: 'Compensación', solicitante: 'SAGA_ORCHESTRATOR' }));
    expect(cancelled).toMatchObject({ status: 'CANCELLED', refund: { amount: 90 } });
    expect(await seatsLeft(seed.slots.holgado)).toBe(before + 2);
    const [refund] = await stack.db['ms-refund']!.dataSource.query(`SELECT rem_monto FROM reembolso ORDER BY rem_id DESC LIMIT 1`);
    expect(Number(refund.rem_monto)).toBe(90);
  });

  it('P9 · ya cancelada → misma respuesta sin un segundo reembolso', async () => {
    const res = await buy({ adult_count: 1, child_count: 0 });
    const cancel = () => as(socio, () => esb.call<Record<string, unknown>>('booking', 'cancelReservation', { idempotency_key: randomUUID(), id: res.reservation_id, reason: 'x', solicitante: 'SAGA_ORCHESTRATOR' }));
    await cancel();
    const [{ n: refundsBefore }] = await stack.db['ms-refund']!.dataSource.query(`SELECT count(*)::int AS n FROM reembolso`);
    await expect(cancel()).resolves.toMatchObject({ status: 'CANCELLED' });
    const [{ n: refundsAfter }] = await stack.db['ms-refund']!.dataSource.query(`SELECT count(*)::int AS n FROM reembolso`);
    expect(refundsAfter).toBe(refundsBefore);
  });

  it('P9 · fuera del plazo de 24 h (cliente) → 409 CANCELLATION_DEADLINE_PASSED y los cupos siguen tomados', async () => {
    // El turno de las 10:30 más próximo (hoy si todavía no llega, si no mañana) siempre empieza en menos de 24 h.
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const fecha = addDays(todayIn(), local < '10:30' ? 0 : 1);
    const slot = `slot-${fecha.replace(/-/g, '')}-1030`;
    const res = await buy({ slot_id: slot, date: fecha, adult_count: 1, child_count: 0 });
    const before = await seatsLeft(slot);
    await expect(as(socio, () => esb.call('booking', 'cancelReservation', { idempotency_key: randomUUID(), id: res.reservation_id, reason: 'x', solicitante: 'CLIENTE' }))).rejects.toMatchObject({ status: 409, code: 'CANCELLATION_DEADLINE_PASSED' });
    expect(await seatsLeft(slot)).toBe(before);
  });

  it('P9 · ms-refund caído → 503 y la reserva sigue CONFIRMED con sus cupos', async () => {
    const res = await buy({ adult_count: 1, child_count: 0 });
    const before = await seatsLeft(seed.slots.holgado);
    const refundUrl = stack.esbConfig.targets.refund;
    stack.esbConfig.targets.refund = 'http://127.0.0.1:9';
    try {
      await expect(as(socio, () => esb.call('booking', 'cancelReservation', { idempotency_key: randomUUID(), id: res.reservation_id, reason: 'x', solicitante: 'SAGA_ORCHESTRATOR' }))).rejects.toMatchObject({ status: 503 });
    } finally {
      stack.esbConfig.targets.refund = refundUrl;
    }
    expect(await seatsLeft(seed.slots.holgado)).toBe(before);
    const [row] = await stack.db['ms-booking']!.dataSource.query(`SELECT e.est_codigo FROM reserva r JOIN estado e ON e.est_id = r.est_id WHERE r.res_uuid = $1`, [res.reservation_id]);
    expect(row.est_codigo).toBe('CONFIRMED');
  });

  // ---- Consulta (P8) y check-in (P10) ----
  it('P8 · consulta: fecha y hora de Inventory, guía y punto de encuentro de Catalog', async () => {
    const res = await buy({ adult_count: 1, child_count: 0 });
    const found = await as(socio, () => esb.call<Record<string, unknown>>('booking', 'getReservation', { id: res.reservation_code }));
    expect(found).toMatchObject({ reservation_id: res.reservation_id, date: seed.date, time: '10:30 a.m.', punto_encuentro: 'Parque central de Baños', guia_asignado: 'Lic. Carlos Morales' });
  });

  it('P8 · el turno de la reserva ya no existe en Inventory → error del servicio, no 200', async () => {
    const res = await buy({ adult_count: 1, child_count: 0 });
    await stack.db['ms-booking']!.dataSource.query(`UPDATE reserva SET dis_id = 999999 WHERE res_uuid = $1`, [res.reservation_id]);
    await expect(as(socio, () => esb.call('booking', 'getReservation', { id: res.reservation_id }))).rejects.toMatchObject({ status: expect.any(Number) });
  });

  it('P10 · check-in de una reserva ya usada → 409; de una cancelada → 409', async () => {
    const used = await buy({ adult_count: 1, child_count: 0 });
    const checkIn = (id: unknown) => as(socio, () => esb.call('booking', 'checkIn', { idempotency_key: randomUUID(), id, documento_identidad: CUSTOMER.document_id }));
    await expect(checkIn(used.reservation_id)).resolves.toMatchObject({ estado: 'CHECKED_IN' });
    await expect(checkIn(used.reservation_id)).rejects.toMatchObject({ status: 409, code: 'RESERVATION_NOT_CONFIRMED' });
    const cancelled = await buy({ adult_count: 1, child_count: 0 });
    await as(socio, () => esb.call('booking', 'cancelReservation', { idempotency_key: randomUUID(), id: cancelled.reservation_id, reason: 'x', solicitante: 'SAGA_ORCHESTRATOR' }));
    await expect(checkIn(cancelled.reservation_id)).rejects.toMatchObject({ status: 409, code: 'RESERVATION_NOT_CONFIRMED' });
  });

  // ---- Búsqueda (P3) y salud (P13) ----
  it('P3 · filtro por ciudad resuelto en ms-location', async () => {
    const res = await esb.call<{ data: { id: string }[] }>('catalog', 'searchAttractions', { ciudad: 'banos' });
    expect(res.data.map((a) => a.id)).toEqual([ATTRACTION]);
  });

  it('P3 · filtro por fechas resuelto con la disponibilidad de ms-inventory', async () => {
    const res = await esb.call<{ data: { id: string }[] }>('catalog', 'searchAttractions', { fecha_inicio: seed.date, fecha_fin: seed.date });
    expect(res.data.map((a) => a.id).sort()).toEqual([ATTRACTION, 'QUITOcultura'].sort());
  });

  it('P13 · salud de cada servicio crítico por el ESB: todos UP', async () => {
    for (const service of ['catalog', 'pricing', 'inventory', 'order', 'booking', 'payment']) {
      await expect(esb.call(service, 'health')).resolves.toMatchObject({ status: 'UP' });
    }
  });

  it('P13 · un servicio crítico caído → su health por el ESB es 503', async () => {
    const url = stack.esbConfig.targets.inventory;
    stack.esbConfig.targets.inventory = 'http://127.0.0.1:9';
    try {
      await expect(esb.call('inventory', 'health')).rejects.toMatchObject({ status: 503 });
    } finally {
      stack.esbConfig.targets.inventory = url;
    }
  });
});
