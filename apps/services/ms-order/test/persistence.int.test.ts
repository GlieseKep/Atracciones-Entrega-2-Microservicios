import { randomUUID } from 'node:crypto';
import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { IdempotencyRepository } from '../src/persistence/idempotency-repository';
import { OrderRepository, type NewOrder } from '../src/persistence/order-repository';

const order = (overrides: Partial<NewOrder> = {}): NewOrder => ({
  owner: { usuId: null, claId: 9 }, caiId: null, mpaId: 1, atrId: 7, nombre: 'Tour Baños', moneda: 'USD', observaciones: null,
  totals: { subtotal: 112.5, descuento: 0, iva: 0, total: 112.5 },
  lines: [{ type: 'ADULT', cantidad: 2, unitPrice: 45, subtotal: 90 }, { type: 'CHILD', cantidad: 1, unitPrice: 22.5, subtotal: 22.5 }],
  coupon: null, ...overrides,
});

describe('ms-order · persistencia en ms_order (P7, P9)', () => {
  let db: MsDatabase;
  let orders: OrderRepository;
  const outbox = async (agregado: string) => (await db.dataSource.query(`SELECT tipo_evento FROM outbox WHERE agregado_id = $1 ORDER BY creado_en`, [agregado])).map((r: { tipo_evento: string }) => r.tipo_evento);

  beforeAll(async () => {
    db = await msDatabase('ms-order');
    orders = new OrderRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('P7 · orden del socio con sus líneas por tipo de boleto y OrdenCreada en la misma transacción', async () => {
    const row = await orders.create(order());
    expect(row).toMatchObject({ est_codigo: 'CREADA', cla_id: '9', usu_id: null, ord_total: '112.50' });
    const lines = await db.dataSource.query(`SELECT det_descripcion, det_cantidad, det_subtotal FROM orden_detalle WHERE ord_id = $1 ORDER BY det_id`, [row.ord_id]);
    expect(lines).toEqual([
      { det_descripcion: 'Tour Baños (ADULT)', det_cantidad: 2, det_subtotal: '90.00' },
      { det_descripcion: 'Tour Baños (CHILD)', det_cantidad: 1, det_subtotal: '22.50' },
    ]);
    await expect(orders.summary(row)).resolves.toMatchObject({ estado: 'CREADA', total: 112.5, det_id_adulto: expect.any(Number) });
    expect(await outbox(row.ord_numero)).toEqual(['OrdenCreada']);
  });

  it('estados: CREADA→PAGADA con OrdenPagada (una sola vez); CREADA→CANCELADA; PAGADA no se cancela; reembolso total → REEMBOLSADA', async () => {
    const paid = await orders.create(order());
    await expect(orders.markPaid(Number(paid.ord_id))).resolves.toBe(true);
    await expect(orders.markPaid(Number(paid.ord_id))).resolves.toBe(false);
    expect(await outbox(paid.ord_numero)).toEqual(['OrdenCreada', 'OrdenPagada']);
    await expect(orders.cancel(Number(paid.ord_id))).resolves.toBe(false);
    await expect(orders.markRefunded(Number(paid.ord_id), 50)).resolves.toBe(false);
    await expect(orders.markRefunded(Number(paid.ord_id), 112.5)).resolves.toBe(true);
    const created = await orders.create(order());
    await expect(orders.cancel(Number(created.ord_id))).resolves.toBe(true);
    expect((await orders.findById(Number(created.ord_id)))?.est_codigo).toBe('CANCELADA');
  });

  it('idempotencia de CreateOrder guardada en la base', async () => {
    const repo = new IdempotencyRepository(db.dataSource);
    const subject = { tipo: 'CLIENTE_API' as const, id: 9 };
    const key = randomUUID();
    await expect(repo.reserve(key, subject, 'CreateOrder', 'H')).resolves.toEqual({ state: 'new' });
    await repo.complete(key, subject, { ord_numero: 'ORD-1' });
    await expect(repo.reserve(key, subject, 'CreateOrder', 'H')).resolves.toEqual({ state: 'done', response: { ord_numero: 'ORD-1' } });
    await expect(repo.reserve(key, subject, 'CreateOrder', 'OTRO')).resolves.toEqual({ state: 'reused' });
  });
});
