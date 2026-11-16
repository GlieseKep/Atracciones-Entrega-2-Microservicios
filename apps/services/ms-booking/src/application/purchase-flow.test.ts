import { AppError } from '@atracciones/platform';
import { as, FakeIdempotency, FakeReservations, purchaseInput, remoteSpy, SECRET, silentLogger, SOCIO, USUARIO, VOUCHER_SECRET } from '../../test/fakes';
import { PurchaseFlow } from './purchase-flow';

/** Orden en que se llamaron los pasos remotos (para verificar las compensaciones LIFO). */
function callOrder(spy: ReturnType<typeof remoteSpy>['spy']): string[] {
  const calls: { name: string; order: number }[] = [];
  for (const [name, fn] of Object.entries(spy)) for (const order of (fn as jest.Mock).mock.invocationCallOrder) calls.push({ name, order });
  return calls.sort((a, b) => a.order - b.order).map((c) => c.name);
}

describe('ms-booking/purchase-flow · P7 saga de compra', () => {
  let reservations: FakeReservations;
  let idempotency: FakeIdempotency;
  let remote: ReturnType<typeof remoteSpy>;
  let flow: PurchaseFlow;

  beforeEach(() => {
    reservations = new FakeReservations();
    idempotency = new FakeIdempotency();
    remote = remoteSpy();
    flow = new PurchaseFlow(reservations.asRepository(), idempotency.asRepository(), remote.remote, { internalToken: SECRET, voucher: VOUCHER_SECRET }, '/api/v3', silentLogger());
  });
  afterEach(() => jest.restoreAllMocks());

  it('P7 · camino feliz: Catalog → Identity → Order → Inventory → reserva → pago, CONFIRMED con PNR y QR', async () => {
    const res = await as(SOCIO, () => flow.run(purchaseInput()));
    expect(callOrder(remote.spy)).toEqual(['reference', 'logistics', 'ensureClient', 'createOrder', 'reserveSeats', 'startPayment', 'slot']);
    expect(res).toMatchObject({ status: 'CONFIRMED', external_order_id: 'ORD-11', reservation_code: expect.stringMatching(/^DEC-[A-Z2-9]{6}$/), voucher_qr_payload: expect.stringContaining('.'), canal: 'SOCIO', client_id: '77' });
    expect(reservations.eventTypes()).toEqual(['RESERVA_CREADA', 'STOCK_ACTUALIZADO', 'RESERVA_CONFIRMADA']);
    expect(remote.spy.releaseSeats).not.toHaveBeenCalled();
    expect(remote.spy.cancelOrder).not.toHaveBeenCalled();
  });

  it('P7 · pide los cupos con la clave RES-<orden> y la cantidad total de boletos', async () => {
    await as(SOCIO, () => flow.run(purchaseInput({ adultos: 2, ninos: 1, infantes: 1 })));
    expect(remote.spy.reserveSeats).toHaveBeenCalledWith('PRhu4UBTWPBC', 'slot-20261125-1030', 4, 'RES-ORD-11');
    expect(remote.spy.createOrder.mock.calls[0][0]).toMatchObject({ boletos: [{ ticket_type: 'ADULT', cantidad: 2 }, { ticket_type: 'CHILD', cantidad: 1 }, { ticket_type: 'INFANT', cantidad: 1 }] });
  });

  it('P7 · falla la atracción (Catalog 404) → 422 ATTRACTION_NOT_FOUND sin orden ni compensación', async () => {
    remote.spy.reference.mockRejectedValue(AppError.unprocessable('ATTRACTION_NOT_FOUND', 'No existe.'));
    await expect(as(SOCIO, () => flow.run(purchaseInput()))).rejects.toMatchObject({ status: 422, code: 'ATTRACTION_NOT_FOUND' });
    expect(remote.spy.createOrder).not.toHaveBeenCalled();
    expect(remote.spy.cancelOrder).not.toHaveBeenCalled();
  });

  it('P7 · falla el turista (Identity) → error sin orden ni compensación', async () => {
    remote.spy.ensureClient.mockRejectedValue(AppError.unprocessable('INVALID_CUSTOMER', 'x'));
    await expect(as(SOCIO, () => flow.run(purchaseInput()))).rejects.toMatchObject({ code: 'INVALID_CUSTOMER' });
    expect(remote.spy.createOrder).not.toHaveBeenCalled();
    expect(remote.spy.cancelOrder).not.toHaveBeenCalled();
  });

  it('P7 · falla la orden → no hay nada que compensar', async () => {
    remote.spy.createOrder.mockRejectedValue(AppError.unavailable());
    await expect(as(SOCIO, () => flow.run(purchaseInput()))).rejects.toMatchObject({ status: 503 });
    expect(remote.spy.reserveSeats).not.toHaveBeenCalled();
    expect(remote.spy.cancelOrder).not.toHaveBeenCalled();
  });

  it('P7 · turno lleno → 409 OUT_OF_STOCK, CancelOrder una vez y ReleaseSeats no aplica', async () => {
    remote.spy.reserveSeats.mockRejectedValue(AppError.conflict('OUT_OF_STOCK', 'Sin cupos.'));
    await expect(as(SOCIO, () => flow.run(purchaseInput()))).rejects.toMatchObject({ status: 409, code: 'OUT_OF_STOCK' });
    expect(remote.spy.cancelOrder).toHaveBeenCalledTimes(1);
    expect(remote.spy.cancelOrder).toHaveBeenCalledWith('ORD-11', 'Sin cupos para la reserva');
    expect(remote.spy.releaseSeats).not.toHaveBeenCalled();
    expect(reservations.rows.size).toBe(0);
  });

  it('P7 · falla guardar la reserva → compensación LIFO: ReleaseSeats antes que CancelOrder', async () => {
    reservations.failCreate = new Error('base caída');
    await expect(as(SOCIO, () => flow.run(purchaseInput()))).rejects.toThrow('base caída');
    expect(callOrder(remote.spy).slice(-2)).toEqual(['releaseSeats', 'cancelOrder']);
    expect(remote.spy.releaseSeats).toHaveBeenCalledWith('RES-ORD-11');
  });

  it('P7 · falla el pago → reserva CANCELLED por SAGA_ORCHESTRATOR, cupos liberados y orden cancelada (LIFO)', async () => {
    remote.spy.startPayment.mockRejectedValue(AppError.unavailable());
    await expect(as(SOCIO, () => flow.run(purchaseInput()))).rejects.toMatchObject({ status: 503 });
    const [row] = reservations.rows.values();
    expect(row.est_codigo).toBe('CANCELLED');
    expect(reservations.eventTypes()).toEqual(['RESERVA_CREADA', 'STOCK_ACTUALIZADO', 'RESERVA_CANCELADA', 'STOCK_ACTUALIZADO']);
    expect(callOrder(remote.spy).slice(-2)).toEqual(['releaseSeats', 'cancelOrder']);
  });

  it('P7 · una compensación que también falla no oculta el error original', async () => {
    remote.spy.reserveSeats.mockRejectedValue(AppError.conflict('OUT_OF_STOCK', 'Sin cupos.'));
    remote.spy.cancelOrder.mockRejectedValue(new Error('Order caído'));
    await expect(as(SOCIO, () => flow.run(purchaseInput()))).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(remote.spy.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it('P7 · pago pendiente (no APROBADO) → la reserva queda PENDING', async () => {
    remote.spy.startPayment.mockResolvedValue({ estado_pago: 'PENDIENTE' });
    await expect(as(SOCIO, () => flow.run(purchaseInput()))).resolves.toMatchObject({ status: 'PENDING' });
    expect(reservations.eventTypes()).not.toContain('RESERVA_CONFIRMADA');
  });

  it('P7 · compra web (USUARIO) no registra turista; titular con RUC de socio tampoco', async () => {
    await as(USUARIO, () => flow.run(purchaseInput()));
    expect(remote.spy.ensureClient).not.toHaveBeenCalled();
    await as(SOCIO, () => flow.run(purchaseInput({ idempotencyKey: '11111111-1111-4111-8111-111111111111', customer: { ...purchaseInput().customer, tipoDocumento: 'RUC', documento: '1710034065001' } })));
    expect(remote.spy.ensureClient).not.toHaveBeenCalled();
  });

  it('P7 · misma Idempotency-Key y mismo cuerpo → misma respuesta sin repetir la compra', async () => {
    const first = await as(SOCIO, () => flow.run(purchaseInput()));
    const second = await as(SOCIO, () => flow.run(purchaseInput()));
    expect(second).toEqual(JSON.parse(JSON.stringify(first)));
    expect(remote.spy.createOrder).toHaveBeenCalledTimes(1);
    expect(remote.spy.reserveSeats).toHaveBeenCalledTimes(1);
  });

  it('sin principal → 401', async () => {
    await expect(flow.run(purchaseInput())).rejects.toMatchObject({ status: 401 });
  });
});
