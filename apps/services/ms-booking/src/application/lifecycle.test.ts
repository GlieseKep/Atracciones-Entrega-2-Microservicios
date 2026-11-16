import { AppError } from '@atracciones/platform';
import { FakeIdempotency, FakeReservations, remoteSpy, reservationRow, silentLogger, SLOT } from '../../test/fakes';
import { Lifecycle } from './lifecycle';

/** `Lifecycle.run` es privado y corre cada 5 min: se ejecuta adelantando el reloj falso. */
async function tick(lifecycle: Lifecycle): Promise<void> {
  lifecycle.start();
  await jest.advanceTimersByTimeAsync(5 * 60_000);
  lifecycle.stop();
}

describe('ms-booking/lifecycle · EXPIRED y COMPLETED', () => {
  let reservations: FakeReservations;
  let idempotency: FakeIdempotency;
  let remote: ReturnType<typeof remoteSpy>;
  let lifecycle: Lifecycle;

  beforeEach(() => {
    // 2026-11-27 en Ecuador: el turno del fake (2026-11-25) ya pasó.
    jest.useFakeTimers({ now: new Date('2026-11-27T15:00:00Z') });
    reservations = new FakeReservations();
    idempotency = new FakeIdempotency();
    remote = remoteSpy();
    lifecycle = new Lifecycle(reservations.asRepository(), idempotency.asRepository(), remote.remote, silentLogger());
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('PENDING sin pagar → orden cancelada, cupos devueltos, EXPIRED con RESERVA_CANCELADA y STOCK_ACTUALIZADO', async () => {
    const row = reservations.add(reservationRow({ est_codigo: 'PENDING', ord_numero: 'ORD-5' }));
    await tick(lifecycle);
    expect(remote.spy.cancelOrder).toHaveBeenCalledWith('ORD-5', 'Reserva sin pagar');
    expect(remote.spy.releaseSeats).toHaveBeenCalledWith('RES-ORD-5');
    expect(reservations.rows.get(row.res_id)!.est_codigo).toBe('EXPIRED');
    expect(reservations.eventTypes()).toEqual(['RESERVA_CANCELADA', 'STOCK_ACTUALIZADO']);
    expect(reservations.events[1].payload).toMatchObject({ cupos_disponibles: 10 });
  });

  it('PENDING cuya orden ya se pagó → no se toca (el evento del pago la confirmará)', async () => {
    remote.spy.cancelOrder.mockRejectedValue(AppError.conflict('ORDER_ALREADY_PAID', 'pagada'));
    const row = reservations.add(reservationRow({ est_codigo: 'PENDING' }));
    await tick(lifecycle);
    expect(remote.spy.releaseSeats).not.toHaveBeenCalled();
    expect(reservations.rows.get(row.res_id)!.est_codigo).toBe('PENDING');
  });

  it('CONFIRMED sin check-in y turno pasado → EXPIRED; turno futuro se mantiene', async () => {
    const past = reservations.add(reservationRow({ dis_id: '50' }));
    const future = reservations.add(reservationRow({ dis_id: '60' }));
    remote.spy.slots.mockImplementation(async (ids: number[]) => ids.map((id) => ({ ...SLOT, dis_id: id, fecha: id === 60 ? '2026-12-01' : '2026-11-25' })));
    await tick(lifecycle);
    expect(reservations.rows.get(past.res_id)!.est_codigo).toBe('EXPIRED');
    expect(reservations.rows.get(future.res_id)!.est_codigo).toBe('CONFIRMED');
  });

  it('CHECKED_IN con turno pasado → COMPLETED', async () => {
    const row = reservations.add(reservationRow({ est_codigo: 'CHECKED_IN' }));
    await tick(lifecycle);
    expect(reservations.rows.get(row.res_id)!.est_codigo).toBe('COMPLETED');
  });

  it('borra las claves de idempotencia vencidas y un error no detiene el proceso', async () => {
    remote.spy.slots.mockRejectedValue(new Error('Inventory caído'));
    reservations.add(reservationRow());
    await expect(tick(lifecycle)).resolves.toBeUndefined();
    expect(idempotency.purged).toBe(1);
  });
});
