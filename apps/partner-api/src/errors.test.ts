import { createLogger } from '@atracciones/platform';
import request from 'supertest';
import { partnerApiWithEsb } from '../test/helpers';
import { ContractStatuses } from './contract';
import { fromValidatorError } from './errors';
import { aliased } from './request';

const logger = createLogger('pruebas');

describe('partner-api · request, errors y contract (T2)', () => {
  beforeAll(() => {
    process.env.LOG_SILENT = 'true';
  });
  afterEach(() => jest.restoreAllMocks());

  it('request · aliased toma el campo en inglés, luego el alias y luego el defecto', () => {
    expect(aliased({ date: 'a', fecha: 'b' }, 'date', 'fecha', 'x')).toBe('a');
    expect(aliased({ fecha: 'b' }, 'date', 'fecha', 'x')).toBe('b');
    expect(aliased(undefined, 'date', 'fecha', 'x')).toBe('x');
  });

  it('errors · paramName: body, query y cabecera con mayúsculas', () => {
    const e = fromValidatorError({ status: 400, message: 'x', errors: [
      { path: '/body/customer/phone', message: 'must match pattern', errorCode: 'pattern.openapi.validation' },
      { path: '/query/date', message: "must have required property 'date'", errorCode: 'required.openapi.validation' },
      { path: '/headers/idempotency-key', message: 'must match format "uuid"', errorCode: 'format.openapi.validation' },
    ] }, logger);
    expect(e.invalidParams?.map((p) => p.name)).toEqual(['customer.phone', 'date', 'Idempotency-Key']);
    expect(e.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('errors · motivos traducidos al español', () => {
    const e = fromValidatorError({ status: 400, message: 'x', errors: [
      { path: '/body/x', message: 'must be integer', errorCode: 'type.openapi.validation' },
      { path: '/body/y', message: "must NOT have additional properties 'y'", errorCode: 'additionalProperties.openapi.validation' },
      { path: '/body/z', message: 'must be equal to one of the allowed values: A, B', errorCode: 'enum.openapi.validation' },
    ] }, logger);
    expect(e.invalidParams?.map((p) => p.reason)).toEqual(['Tipo de dato inválido (debe ser integer).', 'Propiedad no definida en el contrato: y.', 'Valor no permitido: debe ser uno de A, B.']);
  });

  it('errors · estados del validador → códigos del contrato', () => {
    expect(fromValidatorError({ status: 401, message: '', errors: [] }, logger)).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(fromValidatorError({ status: 403, message: '', errors: [] }, logger)).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fromValidatorError({ status: 415, message: '', errors: [] }, logger)).toMatchObject({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('errors · 500 del validador (respuesta fuera de contrato) → INTERNAL_ERROR', () => {
    expect(fromValidatorError({ status: 500, message: 'respuesta inválida', errors: [] }, logger)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('errors · JSON mal formado → 400 application/problem+json', async () => {
    const { api } = partnerApiWithEsb(() => ({}));
    const res = await request(api.app).post('/api/v3/atracciones/search').set('content-type', 'application/json').send('{roto');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('errors · ruta fuera del contrato → 404 ProblemDetails con correlation_id y timestamp', async () => {
    const { api } = partnerApiWithEsb(() => ({}));
    const res = await request(api.app).get('/api/v3/no-existe').set('X-Correlation-Id', 'cid-404');
    expect(res.status).toBe(404);
    expect(res.headers['x-correlation-id']).toBe('cid-404');
    expect(res.body).toMatchObject({ status: 404, correlation_id: 'cid-404', timestamp: expect.any(String) });
  });

  it('contract · carga las 14 operaciones del contrato v3', () => {
    expect(ContractStatuses.load().operations()).toHaveLength(14);
  });

  it('contract · allowedFor acepta la ruta con y sin prefijo /api/v3', () => {
    const statuses = ContractStatuses.load();
    expect([...statuses.allowedFor('GET', '/api/v3/atracciones/{id}')!].sort()).toEqual([...statuses.allowedFor('GET', '/atracciones/{id}')!].sort());
    expect(statuses.allowedFor('POST', '/atracciones/reservas')).toEqual(new Set([201, 400, 401, 403, 409, 422, 500, 503]));
  });

  it('contract · normalize: 4xx no documentado → 400; 5xx → 500, o 503 si es el único', () => {
    const statuses = ContractStatuses.load();
    expect(statuses.normalize('POST', '/atracciones/search', 418)).toBe(400);
    // GET /categorias no documenta 400: un 4xx no documentado cae en 500
    expect(statuses.normalize('GET', '/atracciones/categorias', 418)).toBe(500);
    expect(statuses.normalize('POST', '/atracciones/reservas', 409)).toBe(409);
    expect(statuses.normalize('GET', '/atracciones/health', 500)).toBe(503);
  });

  it('contract · operación desconocida conserva el estado', () => {
    expect(ContractStatuses.load().normalize('GET', '/otra', 418)).toBe(418);
  });
});
