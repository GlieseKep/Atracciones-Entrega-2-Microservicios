import { AppError } from '@atracciones/platform';
import request from 'supertest';
import { authHeaders, IDEM, partnerApiWithEsb, SOCIO, USUARIO, validReservation } from '../../test/helpers';

const CREATED = { id: 'R1', reservation_code: 'PNR123', status: 'CONFIRMED', _links: { self: { href: '/api/v3/atracciones/reservas/R1' } } };

describe('partner-api/handlers/reservations · P7–P10', () => {
  let auth: Record<string, string>;
  beforeAll(async () => {
    auth = await authHeaders(SOCIO);
  });
  afterEach(() => jest.restoreAllMocks());

  const post = (app: Parameters<typeof request>[0], path: string, body: unknown, key: string | null = IDEM, principal = auth) => {
    const req = request(app).post(path).set(principal);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body as object);
  };

  it('P7 · cuerpo válido → 201 con Location y la Idempotency-Key viaja a Booking', async () => {
    const { api, esb } = partnerApiWithEsb(() => CREATED);
    const res = await post(api.app, '/api/v3/atracciones/reservas', validReservation());
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/v3/atracciones/reservas/R1');
    expect(esb).toHaveBeenCalledWith('booking', 'createReservation', expect.objectContaining({ attraction_id: 'PRhu4UBTWPBC', idempotency_key: IDEM }), { idempotencyKey: IDEM });
  });

  it('P7 · sin Idempotency-Key → 400 MISSING_IDEMPOTENCY_KEY', async () => {
    const { api, esb } = partnerApiWithEsb(() => CREATED);
    const res = await post(api.app, '/api/v3/atracciones/reservas', validReservation(), null);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect(esb).not.toHaveBeenCalled();
  });

  it('P7 · campo obligatorio faltante → 400 con invalid_params', async () => {
    const { api } = partnerApiWithEsb(() => CREATED);
    const { customer: _c, ...sinCliente } = validReservation();
    const res = await post(api.app, '/api/v3/atracciones/reservas', sinCliente);
    expect(res.status).toBe(400);
    expect(res.body.invalid_params).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'customer', reason: 'Es obligatorio.' })]));
  });

  it('P7 · alias en español aceptado; alias distinto del campo en inglés → 422 ALIAS_CONFLICT', async () => {
    const { api, esb } = partnerApiWithEsb(() => CREATED);
    const { attraction_id: _a, ...conAlias } = validReservation();
    expect((await post(api.app, '/api/v3/atracciones/reservas', { ...conAlias, atraccion_id: 'PRhu4UBTWPBC' })).status).toBe(201);
    expect(esb.mock.calls[0][2]).toMatchObject({ attraction_id: 'PRhu4UBTWPBC' });
    const res = await post(api.app, '/api/v3/atracciones/reservas', validReservation({ fecha: '2026-11-26' }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ALIAS_CONFLICT');
  });

  it('P7 · idempotency_key del cuerpo distinta de la cabecera → 422', async () => {
    const { api } = partnerApiWithEsb(() => CREATED);
    const res = await post(api.app, '/api/v3/atracciones/reservas', validReservation({ idempotency_key: 'otra' }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('P7 · Booking responde OUT_OF_STOCK → 409 con el ProblemDetails del contrato', async () => {
    const { api } = partnerApiWithEsb(() => { throw AppError.conflict('OUT_OF_STOCK', 'Sin cupos.'); });
    const res = await post(api.app, '/api/v3/atracciones/reservas', validReservation());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ type: 'https://booking.epn.edu.ec/errors/sin-cupos', title: 'Cupos Agotados para el Turno Solicitado', code: 'OUT_OF_STOCK' });
  });

  it('P7 · error no documentado en la operación (404) se ajusta a 400 conservando el code', async () => {
    const { api } = partnerApiWithEsb(() => { throw AppError.notFound('No existe la atracción.', 'ATTRACTION_NOT_FOUND'); });
    const res = await post(api.app, '/api/v3/atracciones/reservas', validReservation());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ATTRACTION_NOT_FOUND');
  });

  it('P7 · sin principal de socio → 401 (security del contrato)', async () => {
    const { api, esb } = partnerApiWithEsb(() => CREATED);
    const res = await request(api.app).post('/api/v3/atracciones/reservas').set('Idempotency-Key', IDEM).send(validReservation());
    expect(res.status).toBe(401);
    expect(esb).not.toHaveBeenCalled();
  });

  it('P8 · reserva inexistente → 404', async () => {
    const { api } = partnerApiWithEsb(() => { throw AppError.notFound('No existe la reserva.'); });
    const res = await request(api.app).get('/api/v3/atracciones/reservas/NOPE').set(auth);
    expect(res.status).toBe(404);
  });

  it('P9 · solicitante: el socio cancela como SAGA_ORCHESTRATOR con motivo; sin enviarlo vale el default del contrato (CLIENTE)', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({ ...CREATED, status: 'CANCELLED' }));
    await post(api.app, '/api/v3/atracciones/reservas/R1/cancel', { reason: 'SAGA_COMPENSATION', solicitante: 'SAGA_ORCHESTRATOR' }).expect(200);
    expect(esb).toHaveBeenLastCalledWith('booking', 'cancelReservation', { idempotency_key: IDEM, id: 'R1', reason: 'SAGA_COMPENSATION', solicitante: 'SAGA_ORCHESTRATOR' }, { idempotencyKey: IDEM });
    // CancelReservationRequest.solicitante tiene `default: CLIENTE` en el contrato v3 y el validador lo completa.
    await post(api.app, '/api/v3/atracciones/reservas/R1/cancel', { reason: 'x' }).expect(200);
    expect(esb.mock.calls[1][2]).toMatchObject({ solicitante: 'CLIENTE' });
  });

  it('P9 · un usuario (JWT) no puede cancelar como SAGA_ORCHESTRATOR → 403', async () => {
    const { api, esb } = partnerApiWithEsb(() => CREATED);
    const res = await post(api.app, '/api/v3/atracciones/reservas/R1/cancel', { solicitante: 'SAGA_ORCHESTRATOR' }, IDEM, await authHeaders(USUARIO));
    expect(res.status).toBe(403);
    expect(esb).not.toHaveBeenCalled();
  });

  it('P10 · check-in envía los datos del titular a Booking; sin documento → 400', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({ status: 'CHECKED_IN' }));
    await post(api.app, '/api/v3/atracciones/reservas/R1/checkin', { documento_identidad: '1710034065', codigo_voucher_qr: 'QR-1' }).expect(200);
    expect(esb.mock.calls[0][2]).toMatchObject({ id: 'R1', documento_identidad: '1710034065', codigo_voucher_qr: 'QR-1', idempotency_key: IDEM });
    expect((await post(api.app, '/api/v3/atracciones/reservas/R1/checkin', {})).status).toBe(400);
  });
});
