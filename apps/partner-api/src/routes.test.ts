import request from 'supertest';
import { authHeaders, partnerApiWithEsb, SOCIO } from '../test/helpers';

describe('partner-api/routes · orden de rutas fijas antes de /:id', () => {
  afterEach(() => jest.restoreAllMocks());

  const calls = (esb: jest.SpyInstance) => esb.mock.calls.map(([service, operation]) => `${service}.${operation}`);

  it('P1 · /atracciones/categorias/arbol no se confunde con /atracciones/:id', async () => {
    const { api, esb } = partnerApiWithEsb(() => []);
    expect((await request(api.app).get('/api/v3/atracciones/categorias/arbol')).status).toBe(200);
    expect(calls(esb)).toEqual(['catalog.getCategoryTree']);
  });

  it('P3 · POST /atracciones/search va a searchAttractions', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({ data: [], metadata: {} }));
    expect((await request(api.app).post('/api/v3/atracciones/search').send({})).status).toBe(200);
    expect(calls(esb)).toEqual(['catalog.searchAttractions']);
  });

  it('P8 y P11 · /atracciones/reservas/:id y /promociones/contrato no van a getAttraction', async () => {
    const { api, esb } = partnerApiWithEsb((_s, op) => (op === 'getReservation' ? { id: 'R1' } : { permite_promociones: true }));
    const auth = await authHeaders(SOCIO);
    expect((await request(api.app).get('/api/v3/atracciones/reservas/R1').set(auth)).status).toBe(200);
    expect((await request(api.app).get('/api/v3/atracciones/promociones/contrato').set(auth)).status).toBe(200);
    expect(calls(esb)).toEqual(['booking.getReservation', 'coupon.getAgreement']);
  });

  it('método no definido en el contrato → 405 METHOD_NOT_ALLOWED como ProblemDetails', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({}));
    const res = await request(api.app).delete('/api/v3/atracciones/categorias');
    expect(res.status).toBe(405);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
    expect(esb).not.toHaveBeenCalled();
  });
});
