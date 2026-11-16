import { AppError } from '@atracciones/platform';
import { ADMIN, as, FakeIdempotency, FakeReservations, remoteSpy, reservationRow, SECRET, SOCIO, USUARIO } from '../../test/fakes';
import { CancellationFlow } from './cancellation-flow';
import { ReservationService } from './reservation-service';

// SLOT del fake: 2026-11-25 10:30 en Ecuador = 2026-11-25T15:30:00Z. El plazo de 24 h vence el 2026-11-24T15:30:00Z.
const DEADLINE = new Date('2026-11-24T15:30:00Z').getTime();
const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

describe('ms-booking/cancellation-flow · P9 cancelación con reembolso del 100 %', () => {
  let reservations: FakeReservations;
  let remote: ReturnType<typeof remoteSpy>;
  let flow: CancellationFlow;

  const setNow = (ms: number) => jest.useFakeTimers({ now: ms, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

  beforeEach(() => {
    setNow(DEADLINE - 3 * 24 * 3600_000);
    reservations = new FakeReservations();
    remote = remoteSpy();
    const service = new ReservationService(reservations.asRepository(), remote.remote, SECRET, '/api/v3');
    flow = new CancellationFlow(reservations.asRepository(), new FakeIdempotency().asRepository(), service, remote.remote, SECRET);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const cancel = (principal = SOCIO, id: string, solicitante: 'CLIENTE' | 'SAGA_ORCHESTRATOR' | 'ADMIN' = 'CLIENTE', key = KEY) =>
    as(principal, () => flow.run(key, id, 'Motivo de prueba', solicitante));

  it('P9 · SAGA_ORCHESTRATOR de un socio: reembolso real, cupos devueltos y eventos RESERVA_CANCELADA + STOCK_ACTUALIZADO', async () => {
    const row = reservations.add(reservationRow({ ord_numero: 'ORD-11' }));
    const res = await cancel(SOCIO, row.res_uuid, 'SAGA_ORCHESTRATOR');
    expect(res).toMatchObject({ status: 'CANCELLED', reembolso_id: 'RF-1', monto_reembolsado: 90, refund: { refund_id: 'RF-1', amount: 90, status: 'PROCESSED' }, stock_restoration: { restored_spots: 2 } });
    expect(remote.spy.refund).toHaveBeenCalledWith(11, 'Motivo de prueba', row.res_uuid);
    expect(remote.spy.releaseSeats).toHaveBeenCalledWith('RES-ORD-11');
    expect(reservations.eventTypes()).toEqual(['RESERVA_CANCELADA', 'STOCK_ACTUALIZADO']);
  });

  it('P9 · SAGA_ORCHESTRATOR no tiene plazo: cancela aunque falte menos de 24 h', async () => {
    setNow(DEADLINE + 3600_000);
    const row = reservations.add(reservationRow());
    await expect(cancel(SOCIO, row.res_uuid, 'SAGA_ORCHESTRATOR')).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('P9 · plazo de 24 h: justo antes del límite el cliente sí cancela', async () => {
    setNow(DEADLINE - 1000);
    const row = reservations.add(reservationRow({ res_canal: 'WEB' }));
    await expect(cancel(USUARIO, row.res_uuid)).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('P9 · plazo de 24 h: exactamente en el límite todavía se permite', async () => {
    setNow(DEADLINE);
    const row = reservations.add(reservationRow({ res_canal: 'WEB' }));
    await expect(cancel(USUARIO, row.res_uuid)).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('P9 · plazo de 24 h: justo después → 409 CANCELLATION_DEADLINE_PASSED sin tocar cupos', async () => {
    setNow(DEADLINE + 1000);
    const row = reservations.add(reservationRow({ res_canal: 'WEB' }));
    await expect(cancel(USUARIO, row.res_uuid)).rejects.toMatchObject({ status: 409, code: 'CANCELLATION_DEADLINE_PASSED' });
    expect(remote.spy.releaseSeats).not.toHaveBeenCalled();
    expect(reservations.rows.get(row.res_id)!.est_codigo).toBe('CONFIRMED');
  });

  it.each(['CHECKED_IN', 'COMPLETED', 'PENDING', 'EXPIRED'] as const)('P9 · estado %s no se cancela → 409 RESERVATION_NOT_CANCELLABLE', async (estado) => {
    const row = reservations.add(reservationRow({ est_codigo: estado }));
    await expect(cancel(SOCIO, row.res_uuid, 'SAGA_ORCHESTRATOR')).rejects.toMatchObject({ status: 409, code: 'RESERVATION_NOT_CANCELLABLE' });
  });

  it('P9 · ya cancelada → devuelve la reserva cancelada sin reembolsar ni liberar otra vez', async () => {
    const row = reservations.add(reservationRow({ est_codigo: 'CANCELLED', res_reembolso_id: 'RF-1', res_monto_reembolsado: '90' }));
    await expect(cancel(SOCIO, row.res_uuid, 'SAGA_ORCHESTRATOR')).resolves.toMatchObject({ status: 'CANCELLED', refund: { refund_id: 'RF-1' } });
    expect(remote.spy.refund).not.toHaveBeenCalled();
    expect(remote.spy.releaseSeats).not.toHaveBeenCalled();
  });

  it('P9 · socio sin pago aprobado: cancela la orden y el reembolso es simulado REF-ATR-<código>', async () => {
    remote.spy.refund.mockResolvedValue(null);
    const row = reservations.add(reservationRow());
    const res = await cancel(SOCIO, row.res_uuid, 'SAGA_ORCHESTRATOR');
    expect(remote.spy.cancelOrder).toHaveBeenCalledWith(row.ord_numero, 'Motivo de prueba');
    expect(res.refund).toMatchObject({ refund_id: `REF-ATR-${row.res_codigo}`, amount: 90, message: 'Reembolso simulado del 100% procesado.' });
  });

  it('P9 · web con orden ya pagada: la orden queda pagada y el reembolso es simulado', async () => {
    remote.spy.cancelOrder.mockRejectedValue(AppError.conflict('ORDER_ALREADY_PAID', 'pagada'));
    const row = reservations.add(reservationRow({ res_canal: 'WEB' }));
    await expect(cancel(USUARIO, row.res_uuid)).resolves.toMatchObject({ status: 'CANCELLED', reembolso_id: `REF-ATR-${row.res_codigo}` });
    expect(remote.spy.refund).not.toHaveBeenCalled();
  });

  it('P9 · un usuario no puede cancelar como SAGA_ORCHESTRATOR ni como ADMIN sin el rol → 403', async () => {
    const row = reservations.add(reservationRow({ res_canal: 'WEB' }));
    await expect(cancel(USUARIO, row.res_uuid, 'SAGA_ORCHESTRATOR')).rejects.toMatchObject({ status: 403 });
    await expect(cancel(USUARIO, row.res_uuid, 'ADMIN', '22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({ status: 403 });
    await expect(cancel(ADMIN, row.res_uuid, 'ADMIN', '33333333-3333-4333-8333-333333333333')).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('P9 · reserva de otro dueño → 403; inexistente → 404', async () => {
    remote.spy.order.mockResolvedValue({ orden: { ord_id: 11, ord_numero: 'X', det_id_adulto: 1, total: 1 }, usu_id: 999, cla_id: 999 });
    const row = reservations.add(reservationRow());
    await expect(cancel(SOCIO, row.res_uuid, 'SAGA_ORCHESTRATOR')).rejects.toMatchObject({ status: 403 });
    await expect(cancel(SOCIO, 'DEC-NOEXIS', 'SAGA_ORCHESTRATOR', '44444444-4444-4444-8444-444444444444')).rejects.toMatchObject({ status: 404, code: 'RESERVATION_NOT_FOUND' });
  });
});
