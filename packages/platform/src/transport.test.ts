import { runWithContext } from './correlation';
import { EsbClient } from './esb-client';
import { fromServiceError, grpc, toServiceError } from './grpc';
import { httpJson } from './http';
import { createLogger } from './logging';
import { AppError } from './problem-details';

/** Respuesta HTTP mínima para el stub de `fetch`. */
const reply = (status: number, body: unknown, contentType = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': contentType } });

describe('esb-client, http y grpc · transporte interno', () => {
  let fetchSpy: jest.SpyInstance;
  const logger = createLogger('pruebas');

  beforeEach(() => {
    process.env.LOG_SILENT = 'true';
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('EsbClient arma la ruta /esb/<servicio>/<operación> con POST y X-Service-Token', async () => {
    fetchSpy.mockResolvedValue(reply(200, { ok: true }));
    const esb = new EsbClient('http://esb.local/', 1000, 'token-de-servicio');
    await expect(esb.call('catalog', 'getAttraction', { id: 'A1' })).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://esb.local/esb/catalog/getAttraction');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ id: 'A1' }) });
    expect(init.headers).toMatchObject({ 'x-service-token': 'token-de-servicio', 'content-type': 'application/json' });
  });

  it('EsbClient envía la Idempotency-Key del paso cuando se indica', async () => {
    fetchSpy.mockResolvedValue(reply(200, {}));
    await new EsbClient('http://esb.local', 1000, 't').call('booking', 'createReservation', {}, { idempotencyKey: 'k-123' });
    expect(fetchSpy.mock.calls[0][1].headers).toMatchObject({ 'idempotency-key': 'k-123' });
  });

  it('httpJson agrega correlación y principal del contexto actual', async () => {
    fetchSpy.mockResolvedValue(reply(200, {}));
    await runWithContext({ correlationId: 'cid-ctx', principalToken: 'jwt-interno' }, () => httpJson('http://svc/x'));
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: expect.objectContaining({ 'x-correlation-id': 'cid-ctx', 'x-internal-principal': 'jwt-interno' }) });
  });

  it('respuesta ProblemDetails → AppError con el mismo status, code e invalid_params', async () => {
    fetchSpy.mockResolvedValue(reply(409, { status: 409, code: 'OUT_OF_STOCK', detail: 'Sin cupos.', invalid_params: [{ name: 'slot_id', reason: 'lleno' }] }, 'application/problem+json'));
    await expect(httpJson('http://svc/x', { body: {} })).rejects.toMatchObject({ status: 409, code: 'OUT_OF_STOCK', message: 'Sin cupos.', invalidParams: [{ name: 'slot_id', reason: 'lleno' }] });
  });

  it('timeout o fallo de red → 503 SERVICE_UNAVAILABLE', async () => {
    fetchSpy.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(httpJson('http://svc/x', { timeoutMs: 10 })).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('cuerpo no JSON: éxito devuelve el texto; error devuelve AppError con el estado HTTP', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, 'texto', 'text/plain'));
    await expect(httpJson('http://svc/x')).resolves.toMatchObject({ status: 200, body: 'texto' });
    fetchSpy.mockResolvedValueOnce(reply(502, '<html>Bad gateway</html>', 'text/html'));
    await expect(httpJson('http://svc/x')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it('grpc · toServiceError lleva el ProblemDetails en la metadata y fromServiceError lo recupera', () => {
    const original = AppError.unprocessable('SLOT_TIME_MISMATCH', 'La hora no coincide.', [{ name: 'time', reason: 'x' }]);
    const serviceError = toServiceError(original, logger, 'CreateReservation') as grpc.ServiceError;
    expect(serviceError.code).toBe(grpc.status.FAILED_PRECONDITION);
    expect(fromServiceError(serviceError)).toMatchObject({ status: 422, code: 'SLOT_TIME_MISMATCH', invalidParams: [{ name: 'time', reason: 'x' }] });
  });

  it('grpc · OUT_OF_STOCK viaja como RESOURCE_EXHAUSTED y sin metadata vuelve a ser 409 OUT_OF_STOCK', () => {
    const serviceError = toServiceError(AppError.conflict('OUT_OF_STOCK', 'Sin cupos.'), logger, 'ReserveSeats') as grpc.ServiceError;
    expect(serviceError.code).toBe(grpc.status.RESOURCE_EXHAUSTED);
    const bare = { code: grpc.status.RESOURCE_EXHAUSTED, details: 'Sin cupos.', metadata: new grpc.Metadata() } as grpc.ServiceError;
    expect(fromServiceError(bare)).toMatchObject({ status: 409, code: 'OUT_OF_STOCK' });
  });

  it('grpc · UNAVAILABLE o DEADLINE_EXCEEDED sin metadata → 503', () => {
    for (const code of [grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED]) {
      expect(fromServiceError({ code, details: '', metadata: new grpc.Metadata() } as grpc.ServiceError)).toMatchObject({ status: 503 });
    }
  });

  it('grpc · error no controlado → INTERNAL sin detalle interno', () => {
    const serviceError = toServiceError(new Error('secreto interno'), logger, 'X') as grpc.ServiceError;
    expect(serviceError.code).toBe(grpc.status.INTERNAL);
    expect(serviceError.details).not.toContain('secreto');
    expect(fromServiceError(serviceError)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });
});
