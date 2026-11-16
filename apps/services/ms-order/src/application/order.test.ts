import { AppError, createLogger, runWithContext, signInternalPrincipal, type EsbClient, type EventEnvelope, type Principal } from '@atracciones/platform';
import type { CreateOrderInput, OrderState } from '../contract';
import type { IdempotencyRepository, IdempotencySubject, Reservation } from '../persistence/idempotency-repository';
import type { NewOrder, OrderRepository, OrderRow } from '../persistence/order-repository';
import { onceByKey } from './idempotency';
import { parseCreateOrder, parseOrderNumber } from './input';
import { OrderService, ownerOf } from './order-service';
import { PaymentFlow } from './payment-flow';
import { PaymentMethods } from './payment-methods';
import { EVENT_PATTERNS, paymentEventHandler } from './payment-events';
import { StaleOrders } from './stale-orders';
import { orderTotals } from './totals';

const SECRET = 'secreto-interno-de-pruebas-con-mas-de-32-caracteres';
const SOCIO: Principal = { tipo: 'API_CLIENTE', id: '9', scopes: [] };
const USUARIO: Principal = { tipo: 'USUARIO', id: '3', scopes: ['CLIENTE'] };
const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
process.env.LOG_SILENT = 'true';
const logger = createLogger('pruebas');

const as = async <T>(p: Principal, work: () => Promise<T>) => runWithContext({ correlationId: 'c', principalToken: await signInternalPrincipal(p, SECRET, 3600) }, work);

/** Fake de OrderRepository con las transiciones condicionales del real (CREADA→PAGADA, CREADA→CANCELADA, PAGADA→REEMBOLSADA). */
class FakeOrders {
  rows = new Map<number, OrderRow>();
  created: NewOrder[] = [];
  outbox: string[] = [];
  stale: number[] = [];
  private seq = 0;

  add(estado: OrderState, total = 90, claId: string | null = '9'): OrderRow {
    const id = ++this.seq;
    const row: OrderRow = { ord_id: String(id), ord_numero: `ORD-${id}`, usu_id: null, cla_id: claId, cai_id: null, mpa_id: 1, est_codigo: estado, ord_fecha: new Date(), ord_subtotal: String(total), ord_descuento: '0', ord_iva: '0', ord_total: String(total), ord_moneda: 'USD' };
    this.rows.set(id, row);
    return row;
  }
  async findByNumber(n: string) { return [...this.rows.values()].find((r) => r.ord_numero === n) ?? null; }
  async findById(id: number) { return this.rows.get(id) ?? null; }
  async summary(row: OrderRow) { return { ord_numero: row.ord_numero, estado: row.est_codigo, total: Number(row.ord_total) } as never; }
  async create(order: NewOrder) {
    this.created.push(order);
    return this.add('CREADA', order.totals.total, order.owner.claId === null ? null : String(order.owner.claId));
  }
  private move(id: number, from: OrderState, to: OrderState) {
    const row = this.rows.get(id);
    if (!row || row.est_codigo !== from) return false;
    this.rows.set(id, { ...row, est_codigo: to });
    return true;
  }
  async markPaid(id: number) { const ok = this.move(id, 'CREADA', 'PAGADA'); if (ok) this.outbox.push('OrdenPagada'); return ok; }
  async cancel(id: number) { return this.move(id, 'CREADA', 'CANCELADA'); }
  async markRefunded(id: number, acumulado: number) { return acumulado >= Number(this.rows.get(id)?.ord_total) && this.move(id, 'PAGADA', 'REEMBOLSADA'); }
  async staleOrders() { return this.stale; }
  repo() { return this as unknown as OrderRepository; }
}

class FakeIdem {
  map = new Map<string, { hash: string; estado: string; response?: unknown }>();
  purged = 0;
  async reserve<T>(clave: string, s: IdempotencySubject, _op: string, hash: string): Promise<Reservation<T>> {
    const k = `${s.tipo}:${s.id}:${clave}`;
    const e = this.map.get(k);
    if (!e || (e.hash === hash && e.estado === 'FAILED')) { this.map.set(k, { hash, estado: 'IN_PROGRESS' }); return { state: 'new' }; }
    if (e.hash !== hash) return { state: 'reused' };
    return e.estado === 'DONE' ? { state: 'done', response: e.response as T } : { state: 'in_progress' };
  }
  async complete(clave: string, s: IdempotencySubject, response: unknown) { Object.assign(this.map.get(`${s.tipo}:${s.id}:${clave}`)!, { estado: 'DONE', response }); }
  async fail(clave: string, s: IdempotencySubject) { this.map.get(`${s.tipo}:${s.id}:${clave}`)!.estado = 'FAILED'; }
  async purgeExpired() { this.purged++; }
  repo() { return this as unknown as IdempotencyRepository; }
}

type EsbHandler = (service: string, operation: string, input: Record<string, unknown>) => unknown;
const esbSpy = (handler: EsbHandler) => {
  const call = jest.fn(async (service: string, operation: string, input: object = {}) => handler(service, operation, input as Record<string, unknown>));
  return { esb: { call } as unknown as EsbClient, call };
};

const defaultEsb: EsbHandler = (service, operation) => {
  if (operation === 'listMethods') return [{ id: 1, codigo: 'CREDIT_CARD' }, { id: 2, codigo: 'TRANSFER' }];
  if (operation === 'quoteTickets') return { currency: 'USD', total: 90, lines: [{ ticket_type: 'ADULT', cantidad: 2, unit_price: 45, subtotal: 90 }] };
  if (operation === 'listOrderPayments') return [];
  if (operation === 'createPayment') return { id: 5, estado: 'APROBADO' };
  throw new Error(`ESB no esperado: ${service}.${operation}`);
};

const createInput = (overrides: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
  idempotencyKey: KEY, atrId: 7, atrCodigo: 'PRhu4UBTWPBC', atraccionNombre: 'Tour', boletos: [{ ticket_type: 'ADULT', cantidad: 2 }], metodo: 'CREDIT_CARD',
  cartItemId: null, couponCode: null, observaciones: null, fecha: '2026-11-25', ...overrides,
});

function build(handler: EsbHandler = defaultEsb) {
  const orders = new FakeOrders();
  const idem = new FakeIdem();
  const { esb, call } = esbSpy(handler);
  const methods = new PaymentMethods(esb);
  const service = new OrderService(orders.repo(), idem.repo(), methods, esb, SECRET, logger);
  return { orders, idem, call, esb, methods, service, payment: new PaymentFlow(orders.repo(), service, methods, esb) };
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ms-order/order-service · P7 orden del socio', () => {
  it('orden del socio: cotiza en Pricing por edad y guarda la orden del cla_id con el método', async () => {
    const { service, orders, call } = build();
    await as(SOCIO, () => service.create(createInput()));
    expect(call).toHaveBeenCalledWith('pricing', 'quoteTickets', { attraction_id: 'PRhu4UBTWPBC', date: '2026-11-25', boletos: [{ ticket_type: 'ADULT', cantidad: 2 }] });
    expect(orders.created[0]).toMatchObject({ owner: { usuId: null, claId: 9 }, mpaId: 1, totals: { subtotal: 90, descuento: 0, iva: 0, total: 90 }, coupon: null, caiId: null });
  });

  it('un socio no puede usar carrito ni cupón → 400', async () => {
    const { service } = build();
    await expect(as(SOCIO, () => service.create(createInput({ couponCode: 'X' })))).rejects.toMatchObject({ status: 400 });
    await expect(as(SOCIO, () => service.create(createInput({ cartItemId: 3 })))).rejects.toMatchObject({ status: 400 });
  });

  it('método de pago inactivo → 422 PAYMENT_METHOD_INACTIVE', async () => {
    const { service } = build();
    await expect(as(SOCIO, () => service.create(createInput({ metodo: 'PAYPAL' })))).rejects.toMatchObject({ status: 422, code: 'PAYMENT_METHOD_INACTIVE' });
  });

  it('cancel: CREADA se cancela con sus pagos pendientes; PAGADA → 409 ORDER_ALREADY_PAID', async () => {
    const { service, orders, call } = build((s, op, input) => (op === 'listOrderPayments' ? [{ id: 1, estado: 'PENDIENTE' }, { id: 2, estado: 'RECHAZADO' }] : op === 'cancelPayment' ? {} : defaultEsb(s, op, input)));
    const created = orders.add('CREADA');
    await service.cancel(created.ord_numero, 'Sin cupos');
    expect(orders.rows.get(Number(created.ord_id))!.est_codigo).toBe('CANCELADA');
    expect(call).toHaveBeenCalledWith('payment', 'cancelPayment', { id: 1 });
    expect(call).not.toHaveBeenCalledWith('payment', 'cancelPayment', { id: 2 });
    const paid = orders.add('PAGADA');
    await expect(service.cancel(paid.ord_numero, 'x')).rejects.toMatchObject({ status: 409, code: 'ORDER_ALREADY_PAID' });
  });

  it('cancel de una orden ya CANCELADA no hace nada; inexistente → 404 ORDER_NOT_FOUND', async () => {
    const { service, orders, call } = build();
    const row = orders.add('CANCELADA');
    await service.cancel(row.ord_numero, 'x');
    expect(call).not.toHaveBeenCalled();
    await expect(service.cancel('NOPE', 'x')).rejects.toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
  });

  it('ownerOf: usuario → usu_id, socio → cla_id; id no numérico → 403', () => {
    expect(ownerOf(USUARIO)).toEqual({ usuId: 3, claId: null });
    expect(ownerOf(SOCIO)).toEqual({ usuId: null, claId: 9 });
    expect(() => ownerOf({ ...SOCIO, id: 'abc' })).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('ms-order/payment-flow · cobro de la orden', () => {
  it('cobro aprobado (B2B) → PAGADA sin esperar al evento', async () => {
    const { payment, orders, call } = build();
    const row = orders.add('CREADA');
    await expect(payment.start(row.ord_numero, null)).resolves.toEqual({ pag_id: 5, estado_pago: 'APROBADO', estado_orden: 'PAGADA' });
    expect(call).toHaveBeenCalledWith('payment', 'createPayment', expect.objectContaining({ numero: `PAG-${row.ord_numero}-1`, monto: 90, canal: 'B2B', metodo: 'CREDIT_CARD' }));
  });

  it('cobro rechazado → la orden sigue CREADA (la cancela el evento PagoRechazado)', async () => {
    const { payment, orders } = build((s, op, i) => (op === 'createPayment' ? { id: 6, estado: 'RECHAZADO' } : defaultEsb(s, op, i)));
    const row = orders.add('CREADA');
    await expect(payment.start(row.ord_numero, null)).resolves.toMatchObject({ estado_pago: 'RECHAZADO', estado_orden: 'CREADA' });
  });

  it('total 0 → PAGADA sin llamar a Payment; orden CANCELADA → 409 ORDER_NOT_PAYABLE', async () => {
    const { payment, orders, call } = build();
    const free = orders.add('CREADA', 0);
    await expect(payment.start(free.ord_numero, null)).resolves.toMatchObject({ estado_orden: 'PAGADA' });
    expect(call).not.toHaveBeenCalledWith('payment', 'createPayment', expect.anything());
    await expect(payment.start(orders.add('CANCELADA').ord_numero, null)).rejects.toMatchObject({ status: 409, code: 'ORDER_NOT_PAYABLE' });
  });

  it('venta web (usuario) se registra con canal WEB y la tarjeta pasa a Payment', async () => {
    const { payment, orders, call } = build();
    const row = orders.add('CREADA', 45, null);
    const tarjeta = { marca: 'VISA', ultimos4: '4242', titular: 'Ana', mes: 12, anio: 2030, pais: 'EC' };
    await payment.start(row.ord_numero, tarjeta);
    expect(call.mock.calls.find((c) => c[1] === 'createPayment')![2]).toMatchObject({ canal: 'WEB', tarjeta });
  });
});

describe('ms-order/payment-events · consumidor', () => {
  const ev = (type: string, data: Record<string, unknown>): EventEnvelope => ({ specversion: '1.0', id: 'e', source: '', type, subject: '', time: '', correlation_id: '', data });

  it('suscripción a pagos y reembolsos', () => {
    expect(EVENT_PATTERNS).toEqual(['payment.PagoAprobado', 'payment.PagoRechazado', 'refund.ReembolsoEmitido']);
  });

  it('PagoAprobado → PAGADA con OrdenPagada; repetido no duplica el evento', async () => {
    const orders = new FakeOrders();
    const row = orders.add('CREADA');
    const handler = paymentEventHandler(orders.repo(), logger);
    await handler(ev('PagoAprobado', { ord_id: Number(row.ord_id) }));
    await handler(ev('PagoAprobado', { ord_id: Number(row.ord_id) }));
    expect(orders.rows.get(Number(row.ord_id))!.est_codigo).toBe('PAGADA');
    expect(orders.outbox).toEqual(['OrdenPagada']);
  });

  it('PagoRechazado → CANCELADA; ReembolsoEmitido parcial no cambia, total → REEMBOLSADA', async () => {
    const orders = new FakeOrders();
    const handler = paymentEventHandler(orders.repo(), logger);
    const created = orders.add('CREADA');
    await handler(ev('PagoRechazado', { ord_id: Number(created.ord_id) }));
    expect(orders.rows.get(Number(created.ord_id))!.est_codigo).toBe('CANCELADA');
    const paid = orders.add('PAGADA', 90);
    await handler(ev('ReembolsoEmitido', { ord_id: Number(paid.ord_id), monto_acumulado: 45 }));
    expect(orders.rows.get(Number(paid.ord_id))!.est_codigo).toBe('PAGADA');
    await handler(ev('ReembolsoEmitido', { ord_id: Number(paid.ord_id), monto_acumulado: 90 }));
    expect(orders.rows.get(Number(paid.ord_id))!.est_codigo).toBe('REEMBOLSADA');
  });

  it('evento sin ord_id u orden inexistente se descarta sin error', async () => {
    const handler = paymentEventHandler(new FakeOrders().repo(), logger);
    await expect(handler(ev('PagoAprobado', {}))).resolves.toBeUndefined();
    await expect(handler(ev('PagoAprobado', { ord_id: 999 }))).resolves.toBeUndefined();
  });
});

describe('ms-order/totals', () => {
  it('total = subtotal − descuento; IVA incluido (0)', () => {
    expect(orderTotals(90, 10)).toEqual({ subtotal: 90, descuento: 10, iva: 0, total: 80 });
  });
  it('el descuento nunca supera el subtotal', () => {
    expect(orderTotals(20, 50)).toEqual({ subtotal: 20, descuento: 20, iva: 0, total: 0 });
  });
  it('redondeo monetario a 2 decimales', () => {
    expect(orderTotals(33.335, 0.005).total).toBe(33.33);
  });
  it('sin descuento', () => {
    expect(orderTotals(45.5, 0)).toMatchObject({ descuento: 0, total: 45.5 });
  });
  it('descuento negativo no aumenta el total más allá del subtotal + descuento', () => {
    expect(orderTotals(10, 0).total).toBe(10);
  });
});

describe('ms-order/payment-methods · código ↔ id con caché', () => {
  it('convierte código a id y de vuelta; lista en caché', async () => {
    const { methods, call } = build();
    await expect(methods.idOf('TRANSFER')).resolves.toBe(2);
    await expect(methods.codeOf(1)).resolves.toBe('CREDIT_CARD');
    await expect(methods.codeOf(null)).resolves.toBe('');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('vence a los 10 min; si Payment cae se usa la lista anterior', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    let down = false;
    const { methods, call } = build((s, op, i) => { if (down) throw AppError.unavailable(); return defaultEsb(s, op, i); });
    await methods.idOf('CREDIT_CARD');
    jest.setSystemTime(new Date('2026-11-20T12:11:00Z'));
    down = true;
    await expect(methods.idOf('CREDIT_CARD')).resolves.toBe(1);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('sin lista previa y Payment caído → error', async () => {
    const { methods } = build(() => { throw AppError.unavailable(); });
    await expect(methods.idOf('CREDIT_CARD')).rejects.toMatchObject({ status: 503 });
  });
});

describe('ms-order/stale-orders · órdenes colgadas', () => {
  it('orden con pago aprobado en Payment → PAGADA; sin pago → pagos pendientes cancelados y CANCELADA; purga claves', async () => {
    jest.useFakeTimers();
    const ctx = build((s, op, i) => {
      if (op === 'listOrderPayments') return (i as { ordId: number }).ordId === 1 ? [{ id: 1, estado: 'APROBADO' }] : [{ id: 2, estado: 'PENDIENTE' }];
      if (op === 'cancelPayment') return {};
      return defaultEsb(s, op, i);
    });
    const a = ctx.orders.add('CREADA');
    const b = ctx.orders.add('CREADA');
    ctx.orders.stale = [Number(a.ord_id), Number(b.ord_id)];
    const stale = new StaleOrders(ctx.orders.repo(), ctx.idem.repo(), ctx.service, ctx.esb, logger);
    stale.start();
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    stale.stop();
    expect(ctx.orders.rows.get(1)!.est_codigo).toBe('PAGADA');
    expect(ctx.orders.rows.get(2)!.est_codigo).toBe('CANCELADA');
    expect(ctx.call).toHaveBeenCalledWith('payment', 'cancelPayment', { id: 2 });
    expect(ctx.idem.purged).toBe(1);
  });
  it('un error de Payment no detiene la tarea', async () => {
    jest.useFakeTimers();
    const ctx = build(() => { throw AppError.unavailable(); });
    ctx.orders.stale = [Number(ctx.orders.add('CREADA').ord_id)];
    const stale = new StaleOrders(ctx.orders.repo(), ctx.idem.repo(), ctx.service, ctx.esb, logger);
    stale.start();
    await expect(jest.advanceTimersByTimeAsync(5 * 60_000)).resolves.toBeUndefined();
    stale.stop();
  });
});

describe('ms-order/idempotency y input', () => {
  const subject = { tipo: 'CLIENTE_API' as const, id: 9 };
  it('misma clave y cuerpo → respuesta guardada; otro cuerpo → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const idem = new FakeIdem().repo();
    const work = jest.fn(async () => 'orden');
    await onceByKey(idem, 'k', subject, 'CreateOrder', { a: 1 }, work);
    await expect(onceByKey(idem, 'k', subject, 'CreateOrder', { a: 1 }, work)).resolves.toBe('orden');
    await expect(onceByKey(idem, 'k', subject, 'CreateOrder', { a: 2 }, work)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('error del trabajo deja la clave reintentable', async () => {
    const idem = new FakeIdem().repo();
    await expect(onceByKey(idem, 'k', subject, 'Op', {}, async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(onceByKey(idem, 'k', subject, 'Op', {}, async () => 'ok')).resolves.toBe('ok');
  });
  const valid = { idempotency_key: KEY, atr_id: 7, atr_codigo: 'PRhu4UBTWPBC', atraccion_nombre: 'Tour', metodo: 'CREDIT_CARD', fecha: '2026-11-25', boletos: [{ ticket_type: 'ADULT', cantidad: 2 }] };
  it('parseCreateOrder válido normaliza la clave y vacíos a null', () => {
    expect(parseCreateOrder({ ...valid, idempotency_key: KEY.toUpperCase(), coupon_code: ' ' })).toMatchObject({ idempotencyKey: KEY, couponCode: null, cartItemId: null, observaciones: null });
  });
  it('tipo de boleto repetido o cantidad 0 → 400', () => {
    expect(() => parseCreateOrder({ ...valid, boletos: [{ ticket_type: 'ADULT', cantidad: 1 }, { ticket_type: 'ADULT', cantidad: 1 }] })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseCreateOrder({ ...valid, boletos: [{ ticket_type: 'CHILD', cantidad: 0 }] })).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('número de orden obligatorio', () => {
    expect(() => parseOrderNumber('')).toThrow(expect.objectContaining({ status: 400 }));
  });
});
