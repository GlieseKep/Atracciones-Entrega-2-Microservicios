import { expectContractHeaders, expectSchema, startE2E, type E2E } from './e2e-helpers';
import request from 'supertest';
import { API_KEY, ATTRACTION } from '../../fixtures/v3/seed';

/** E2E · P1–P6 por el Gateway /api/v3, como los ejecuta Booking (un caso por proceso). */
describe('E2E v3 · catálogo (P1–P6)', () => {
  let e2e: E2E;
  const gw = () => request(e2e.stack.gatewayUrl);

  beforeAll(async () => {
    e2e = await startE2E();
  }, 180_000);
  afterAll(async () => {
    await e2e?.close();
  });

  it('P1 · árbol de categorías con las banderas incluye_comida, incluye_transporte, incluye_guia', async () => {
    const res = await gw().get('/api/v3/atracciones/categorias/arbol').set('X-API-Key', API_KEY);
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'CategoryTreeNode', true);
    const aventura = res.body.find((c: { id: string }) => c.id === 'cat-aventura-100');
    expect(aventura.subcategorias).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'cat-rafting-200', incluye_comida: true, incluye_transporte: true, incluye_guia: true })]));
  });

  it('P2 · listado plano de categorías', async () => {
    const res = await gw().get('/api/v3/atracciones/categorias');
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'CategoryFlat', true);
    expect(res.body.map((c: { id: string }) => c.id)).toContain('cat-aventura-100');
  });

  it('P3 · búsqueda avanzada con filtros combinados y paginación', async () => {
    const res = await gw().post('/api/v3/atracciones/search').send({ ciudad: 'Baños', incluye_comida: true, idioma_guia: 'Ingles', page: 1, limit: 5 });
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'SearchAtraccionesResponseV2');
    expect(res.body.metadata).toMatchObject({ total_results: 1, page: 1, limit: 5, total_pages: 1 });
    expect(res.body.data[0].id).toBe(ATTRACTION);
  });

  it('P4 · listado de atracciones (página) con horarios', async () => {
    const res = await gw().get('/api/v3/atracciones?page=1&limit=10');
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'AtraccionListadoSimple', true);
    expect(res.body.find((a: { id: string }) => a.id === ATTRACTION).horarios).toEqual(['10:30 a.m.', '03:00 p.m.', '05:00 p.m.']);
  });

  it('P5 · ficha técnica completa: itinerario, punto de encuentro, tarifas por edad y valoraciones', async () => {
    const res = await gw().get(`/api/v3/atracciones/${ATTRACTION}`);
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'AtraccionDetailResponseV2');
    expect(res.body).toMatchObject({
      id: ATTRACTION,
      price: { adult: 45, child: 22.5, senior: 31.5, infant: 0 },
      itinerary: [expect.objectContaining({ stop_number: 1, time: '10:30 a.m.' })],
      meeting_point_geo: expect.objectContaining({ latitude: expect.any(Number), longitude: expect.any(Number) }),
      rating: expect.objectContaining({ score: expect.any(Number), review_count: expect.any(Number) }),
    });
  });

  it('P6 · disponibilidad: DISPONIBLE, ULTIMOS_CUPOS y AGOTADO en los turnos del día', async () => {
    const res = await gw().get(`/api/v3/atracciones/${ATTRACTION}/disponibilidad?date=${e2e.seed.date}`);
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'DisponibilidadResponse');
    expect(res.body.time_slots.map((s: { slot_id: string; status: string }) => [s.slot_id, s.status])).toEqual([
      [e2e.seed.slots.holgado, 'DISPONIBLE'],
      [e2e.seed.slots.ultimo, 'ULTIMOS_CUPOS'],
      [e2e.seed.slots.lleno, 'AGOTADO'],
    ]);
  });
});
