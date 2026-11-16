import { ADMIN, as, FakeIdempotency, FakeNotifications, FakeReservations, notifierSpy, remoteSpy, reservationRow, SECRET, silentLogger, SOCIO, USUARIO, VOUCHER_SECRET } from '../../test/fakes';
import { CheckinService, type CheckinInput } from './checkin-service';
import { createVoucher } from './voucher';

// Turno del fake: 2026-11-25 (Ecuador).
const DAY_BEFORE = new Date('2026-11-24T20:00:00Z');

describe('ms-booking/checkin-service · P10 check-in', () => {
  let reservations: FakeReservations;
  let notifications: FakeNotifications;
  let notifier: ReturnType<typeof notifierSpy>;
  let remote: ReturnType<typeof remoteSpy>;
  let service: CheckinService;
  let n = 0;

  const input = (id: string, overrides: Partial<CheckinInput> = {}): CheckinInput => ({
    key: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, id, documento: '1710034065', voucher: null, guiaCodigo: 'GUIA-1', dispositivo: null, asistentes: null, observaciones: null, ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: DAY_BEFORE, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    reservations = new FakeReservations();
    notifications = new FakeNotifications();
    notifier = notifierSpy();
    remote = remoteSpy();
    service = new CheckinService(reservations.asRepository(), new FakeIdempotency().asRepository(), remote.remote, notifications.asRepository(), notifier, { internalToken: SECRET, voucher: VOUCHER_SECRET }, silentLogger());
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('P10 · titular válido con QR firmado → CHECKED_IN, aviso a Booking Central (socio) y envío inmediato', async () => {
    const row = reservations.add(reservationRow());
    const voucher = createVoucher({ reservationId: row.res_uuid, code: row.res_codigo, document: row.pax_documento }, VOUCHER_SECRET);
    reservations.rows.set(row.res_id, { ...row, res_voucher_qr: voucher });
    const res = await as(SOCIO, () => service.run(input(row.res_uuid, { voucher })));
    expect(res).toMatchObject({ estado: 'CHECKED_IN', titular_documento: '1710034065', guia_asignado: 'Carlos', punto_encuentro: 'Parque central', pase_abordar_qr: voucher });
    expect(notifications.inserted).toEqual([{ resId: row.res_id, payload: expect.objectContaining({ external_order_id: row.ord_numero, estado: 'CONFIRMADO_ASISTIDO', asistentes_reales: 2, admin_id: 'GUIA-1' }) }]);
  });

  it('P10 · documento distinto del titular → 403 DOCUMENT_MISMATCH', async () => {
    const row = reservations.add(reservationRow());
    await expect(as(SOCIO, () => service.run(input(row.res_uuid, { documento: '0912345678' })))).rejects.toMatchObject({ status: 403, code: 'DOCUMENT_MISMATCH' });
    expect(reservations.rows.get(row.res_id)!.est_codigo).toBe('CONFIRMED');
  });

  it('P10 · QR de otra reserva → 403 INVALID_VOUCHER', async () => {
    const row = reservations.add(reservationRow());
    const other = createVoucher({ reservationId: 'otra', code: 'X', document: row.pax_documento }, VOUCHER_SECRET);
    await expect(as(SOCIO, () => service.run(input(row.res_uuid, { voucher: other })))).rejects.toMatchObject({ status: 403, code: 'INVALID_VOUCHER' });
  });

  it.each(['CHECKED_IN', 'CANCELLED', 'EXPIRED'] as const)('P10 · reserva %s → 409 RESERVATION_NOT_CONFIRMED', async (estado) => {
    const row = reservations.add(reservationRow({ est_codigo: estado }));
    await expect(as(SOCIO, () => service.run(input(row.res_uuid)))).rejects.toMatchObject({ status: 409, code: 'RESERVATION_NOT_CONFIRMED' });
  });

  it('P10 · fecha del turno ya pasada → 409 CHECKIN_OUT_OF_DATE; el mismo día sí se permite', async () => {
    const row = reservations.add(reservationRow());
    jest.setSystemTime(new Date('2026-11-26T06:00:00Z'));
    await expect(as(SOCIO, () => service.run(input(row.res_uuid)))).rejects.toMatchObject({ status: 409, code: 'CHECKIN_OUT_OF_DATE' });
    jest.setSystemTime(new Date('2026-11-26T04:00:00Z')); // todavía 25 en Ecuador
    await expect(as(SOCIO, () => service.run(input(row.res_uuid)))).resolves.toMatchObject({ estado: 'CHECKED_IN' });
  });

  it('P10 · más asistentes que boletos → 400; compra web no genera aviso; usuario sin rol de personal → 403', async () => {
    const row = reservations.add(reservationRow());
    await expect(as(SOCIO, () => service.run(input(row.res_uuid, { asistentes: 3 })))).rejects.toMatchObject({ status: 400 });
    const web = reservations.add(reservationRow({ res_canal: 'WEB' }));
    await as(ADMIN, () => service.run(input(web.res_uuid)));
    expect(notifications.inserted.map((x) => x.resId)).not.toContain(web.res_id);
    const other = reservations.add(reservationRow());
    await expect(as(USUARIO, () => service.run(input(other.res_uuid)))).rejects.toMatchObject({ status: 403 });
  });
});
