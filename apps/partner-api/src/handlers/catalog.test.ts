import { AppError } from '@atracciones/platform';
import request from 'supertest';
import { partnerApiWithEsb } from '../../test/helpers';

describe('partner-api/handlers/catalog · P1–P6', () => {
  afterEach(() => jest.restoreAllMocks());

  it('P2 · categorías: pasa padre_id al ESB y guarda en caché (segunda llamada no va al ESB)', async () => {
    const { api, esb } = partnerApiWithEsb(() => [{ id: 'c1' }]);
    await request(api.app).get('/api/v3/atracciones/categorias?padre_id=c0').expect(200);
    await request(api.app).get('/api/v3/atracciones/categorias?padre_id=c0').expect(200).expect('Cache-Control', 'public, max-age=60');
    expect(esb).toHaveBeenCalledTimes(1);
    expect(esb).toHaveBeenCalledWith('catalog', 'listCategories', { padre_id: 'c0' });
  });

  it('P3 · búsqueda: el cuerpo con filtros llega al ESB tal cual', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({ data: [], metadata: {} }));
    const filtros = { destino_ciudad: 'Baños', page: 2 };
    await request(api.app).post('/api/v3/atracciones/search').send(filtros).expect(200);
    expect(esb.mock.calls[0][2]).toMatchObject(filtros);
  });

  it('P3 · búsqueda con un filtro de tipo inválido → 400 sin llamar al ESB', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({}));
    const res = await request(api.app).post('/api/v3/atracciones/search').send({ page: 'uno' });
    expect(res.status).toBe(400);
    expect(res.body.invalid_params?.[0]?.name).toBe('page');
    expect(esb).not.toHaveBeenCalled();
  });

  it('P4 · listado: la query (paginación) llega a Catalog y se agregan los horarios de Inventory en formato 12 h', async () => {
    const { api, esb } = partnerApiWithEsb((service) =>
      service === 'catalog'
        ? { data: [{ id: 'A1', name: 'Tour', price: 45, city: 'Quito', duration: '2 horas' }] }
        : { items: [{ atraccion_id: 'A1', horas: ['10:30:00', '15:00:00'] }] },
    );
    const res = await request(api.app).get('/api/v3/atracciones?page=2&limit=5').expect(200);
    expect(esb.mock.calls[0]).toEqual(['catalog', 'listAttractions', expect.objectContaining({ page: 2, limit: 5 })]);
    expect(esb.mock.calls[1]).toEqual(['inventory', 'listScheduleTimes', { atraccion_ids: ['A1'] }]);
    expect(res.body).toEqual([{ id: 'A1', nombre: 'Tour', precio: 45, ciudad: 'Quito', duracion: '2 horas', horarios: ['10:30 a.m.', '03:00 p.m.'] }]);
  });

  it('P4 · listado vacío no consulta Inventory', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({ data: [] }));
    await request(api.app).get('/api/v3/atracciones').expect(200, []);
    expect(esb).toHaveBeenCalledTimes(1);
  });

  it('P5 · ficha: devuelve lo de Catalog (con _links) y la guarda en caché', async () => {
    const ficha = { id: 'A1', nombre: 'Tour', _links: { self: { href: '/api/v3/atracciones/A1' } } };
    const { api, esb } = partnerApiWithEsb(() => ficha);
    await request(api.app).get('/api/v3/atracciones/A1').expect(200, ficha);
    await request(api.app).get('/api/v3/atracciones/A1').expect(200);
    expect(esb).toHaveBeenCalledTimes(1);
    expect(esb).toHaveBeenCalledWith('catalog', 'getAttraction', { id: 'A1' });
  });

  it('P5 · atracción inexistente → 404 ProblemDetails', async () => {
    const { api } = partnerApiWithEsb(() => { throw AppError.notFound('No existe la atracción X.'); });
    const res = await request(api.app).get('/api/v3/atracciones/X');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND', instance: '/api/v3/atracciones/X' });
  });

  it('P6 · disponibilidad: date obligatoria, alias fecha aceptado y nunca desde caché', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({ slots: [] }));
    expect((await request(api.app).get('/api/v3/atracciones/A1/disponibilidad')).status).toBe(400);
    await request(api.app).get('/api/v3/atracciones/A1/disponibilidad?fecha=2026-11-25').expect(200).expect('Cache-Control', 'no-store');
    await request(api.app).get('/api/v3/atracciones/A1/disponibilidad?date=2026-11-25').expect(200);
    expect(esb.mock.calls).toEqual([
      ['inventory', 'getAvailability', { id: 'A1', date: '2026-11-25' }],
      ['inventory', 'getAvailability', { id: 'A1', date: '2026-11-25' }],
    ]);
    expect((await request(api.app).get('/api/v3/atracciones/A1/disponibilidad?date=2026-11-25&fecha=2026-11-26')).status).toBe(422);
  });
});
