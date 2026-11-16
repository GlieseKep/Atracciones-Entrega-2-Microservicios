import { randomUUID } from 'node:crypto';
import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { EventRepository } from '../src/persistence/event-repository';
import { IdempotencyRepository } from '../src/persistence/idempotency-repository';
import { newReservationCode, ReservationRepository, type NewReservation } from '../src/persistence/reservation-repository';

const newReservation = (overrides: Partial<NewReservation> = {}): NewReservation => ({
  uuid: randomUUID(), codigo: newReservationCode(), ordNumero: `ORD-${randomUUID().slice(0, 8)}`, detId: 1, disId: 50, guiId: null, sagaId: null,
  adultos: 2, ninos: 0, seniors: 0, infantes: 0, total: 90, requerimientos: null, voucher: 'qr',
  customer: { nombre: 'Ana Pérez', correo: 'ana@correo.com', telefono: '0991234567', tipoDocumento: 'CEDULA', documento: '1710034065' },
  claIdCliente: 77, canal: 'SOCIO', ...overrides,
});

describe('ms-booking · persistencia en ms_booking (P7–P12)', () => {
  let db: MsDatabase;
  let events: EventRepository;
  let reservations: ReservationRepository;

  beforeAll(async () => {
    db = await msDatabase('ms-booking');
    events = new EventRepository(db.dataSource);
    reservations = new ReservationRepository(db.dataSource, events);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('P7 · reserva, titular y eventos en la misma transacción; consulta por UUID o PNR', async () => {
    const data = newReservation();
    const row = await reservations.create(data, [{ tipo: 'RESERVA_CREADA', payload: { a: 1 } }, { tipo: 'STOCK_ACTUALIZADO', payload: { b: 2 } }]);
    expect(row).toMatchObject({ est_codigo: 'PENDING', res_codigo: data.codigo, pax_documento: '1710034065', res_numero_tickets: 2, res_canal: 'SOCIO' });
    expect((await reservations.find(data.codigo.toLowerCase()))?.res_uuid).toBe(data.uuid);
    const [{ n }] = await db.dataSource.query(`SELECT count(*)::int AS n FROM outbox_evento WHERE evt_aggregate_id = $1`, [data.codigo]);
    expect(n).toBe(2);
  });

  it('P7 · si un evento falla, la reserva no queda guardada (rollback)', async () => {
    const data = newReservation();
    await expect(reservations.create(data, [{ tipo: 'NO_EXISTE' as never, payload: {} }])).rejects.toBeDefined();
    await expect(reservations.find(data.uuid)).resolves.toBeNull();
  });

  it('P9 · transición válida PENDING→CONFIRMED→CANCELLED; inválida devuelve null sin cambiar ni emitir', async () => {
    const row = await reservations.create(newReservation(), []);
    const confirmed = await reservations.transition(row.res_id, ['PENDING'], 'CONFIRMED', { res_confirmado_en: new Date() }, () => [{ tipo: 'RESERVA_CONFIRMADA', payload: {} }]);
    expect(confirmed?.est_codigo).toBe('CONFIRMED');
    const again = await reservations.transition(row.res_id, ['PENDING'], 'CONFIRMED', {}, () => [{ tipo: 'RESERVA_CONFIRMADA', payload: {} }]);
    expect(again).toBeNull();
    const cancelled = await reservations.transition(row.res_id, ['CONFIRMED'], 'CANCELLED', { res_motivo_cancelacion: 'Compensación', res_cancelado_por: 'SAGA_ORCHESTRATOR', res_cancelado_en: new Date(), res_reembolso_id: 'RF-1', res_monto_reembolsado: 90 }, () => [{ tipo: 'RESERVA_CANCELADA', payload: {} }]);
    expect(cancelled).toMatchObject({ est_codigo: 'CANCELLED', res_reembolso_id: 'RF-1' });
    const types = (await db.dataSource.query(`SELECT evt_tipo FROM outbox_evento WHERE evt_aggregate_id = $1 ORDER BY evt_id`, [row.res_codigo])).map((r: { evt_tipo: string }) => r.evt_tipo);
    expect(types).toEqual(['RESERVA_CONFIRMADA', 'RESERVA_CANCELADA']);
  });

  it('P12 · feed ordenado por evt_id, con cursor after, límite y filtro por tipo', async () => {
    const all = await events.list(0, 200, null);
    expect(all.map((e) => Number(e.evt_id))).toEqual([...all.map((e) => Number(e.evt_id))].sort((a, b) => a - b));
    const after = await events.list(Number(all[0].evt_id), 2, null);
    expect(after).toHaveLength(2);
    expect(Number(after[0].evt_id)).toBeGreaterThan(Number(all[0].evt_id));
    const stock = await events.list(0, 200, 'STOCK_ACTUALIZADO');
    expect(stock.length).toBeGreaterThan(0);
    expect(stock.every((e) => e.evt_tipo === 'STOCK_ACTUALIZADO')).toBe(true);
    expect(all[0]).toMatchObject({ evt_specversion: '1.0', evt_fuente: expect.any(String), evt_uuid: expect.any(String) });
  });

  it('P7 · idempotencia guardada: new → done con la respuesta; otro hash es reused; FAILED se puede reintentar', async () => {
    const repo = new IdempotencyRepository(db.dataSource);
    const subject = { tipo: 'CLIENTE_API' as const, id: 9 };
    const key = randomUUID();
    await expect(repo.reserve(key, subject, 'CreateReservation', 'H1')).resolves.toEqual({ state: 'new' });
    await expect(repo.reserve(key, subject, 'CreateReservation', 'H1')).resolves.toEqual({ state: 'in_progress' });
    await repo.complete(key, subject, { pnr: 'DEC-1' });
    await expect(repo.reserve(key, subject, 'CreateReservation', 'H1')).resolves.toEqual({ state: 'done', response: { pnr: 'DEC-1' } });
    await expect(repo.reserve(key, subject, 'CreateReservation', 'H2')).resolves.toEqual({ state: 'reused' });
    const other = randomUUID();
    await repo.reserve(other, subject, 'CreateReservation', 'H1');
    await repo.fail(other, subject);
    await expect(repo.reserve(other, subject, 'CreateReservation', 'H1')).resolves.toEqual({ state: 'new' });
  });
});
