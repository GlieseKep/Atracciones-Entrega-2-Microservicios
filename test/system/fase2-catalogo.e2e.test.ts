import { addDays, todayIn } from '@atracciones/platform';
import request from 'supertest';
import { startSystem, userToken, type System } from './harness';

/**
 * Fase 2 (plan §8): las 8 rutas de lectura responden y pasan la validación de respuesta contra el YAML (el arnés la
 * activa: una respuesta fuera del contrato sería un 500), /disponibilidad refleja al instante un cambio en
 * turnos_aforo y, con Inventory detenido, responde 503.
 */
describe('Fase 2 — Catálogo y disponibilidad', () => {
  let system: System;
  let apiKey: string;
  const http = () => request(system.gatewayUrl);
  const tomorrow = () => addDays(todayIn('America/Guayaquil'), 1);

  beforeAll(async () => {
    system = await startSystem({ catalog: true, healthCritical: ['catalog', 'inventory'] });
    apiKey = (await system.identity.accounts.createApiKey({ nombre: 'booking-prototipo', email: 'integracion@booking.test' })).apiKey;
  });
  afterAll(async () => {
    await system?.close();
  });

  it('GET /categorias/arbol devuelve el árbol con las banderas obligatorias', async () => {
    const res = await http().get('/api/v2/atracciones/categorias/arbol').expect(200);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual(['cat-tours-100', 'cat-cultura-200', 'cat-naturaleza-300', 'cat-entradas-400']);
    const tours = res.body[0];
    expect(tours).toEqual(expect.objectContaining({ nombre: 'Tours y Experiencias Guiadas', incluye_comida: false, incluye_transporte: true, incluye_guia: true }));
    expect(tours.subcategorias.map((c: { id: string }) => c.id)).toEqual(['cat-tours-201', 'cat-tours-202', 'cat-tours-203']);
    expect(res.body[1].subcategorias).toEqual([]);
  });

  it('GET /categorias devuelve solo las raíces sin padre_id y las hijas con padre_id', async () => {
    const roots = await http().get('/api/v2/atracciones/categorias').expect(200);
    expect(roots.body).toHaveLength(4);
    expect(roots.body.every((c: { padre_id: unknown }) => c.padre_id === null)).toBe(true);
    const hijas = await http().get('/api/v1/atracciones/categorias').query({ padre_id: 'cat-tours-100' }).expect(200);
    expect(hijas.body.map((c: { id: string }) => c.id)).toEqual(['cat-tours-201', 'cat-tours-202', 'cat-tours-203']);
    expect(hijas.body[0].padre_id).toBe('cat-tours-100');
  });

  it('GET /atracciones pagina, filtra y ordena', async () => {
    const page = await http().get('/api/v2/atracciones').query({ limit: 3, sort: 'PRICE_ASC' }).expect(200);
    expect(page.body.metadata).toEqual(expect.objectContaining({ total_results: 10, page: 1, limit: 3, total_pages: 4 }));
    expect(page.body.data).toHaveLength(3);
    const prices = page.body.data.map((c: { price: { adult: number } }) => c.price.adult);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(page.body.data[0]).toEqual(expect.objectContaining({ id: 'QTOTELEFRQ01', price: expect.objectContaining({ adult: 9.5, infant: 0, currency: 'USD', adulto: 9.5 }) }));

    const quito = await http().get('/api/v2/atracciones').query({ city: 'quito', incluye_guia: true, limit: 50 }).expect(200);
    expect(quito.body.data.length).toBeGreaterThan(0);
    expect(quito.body.data.every((c: { city: string; inclusions: { incluye_guia: boolean } }) => c.city === 'Quito' && c.inclusions.incluye_guia)).toBe(true);

    const volcanes = await http().get('/api/v2/atracciones').query({ categoria_id: 'cat-tours-100', limit: 50 }).expect(200);
    expect(volcanes.body.metadata.total_results).toBe(5); // incluye las subcategorías
  });

  it('POST /search aplica texto, precio, idioma y disponibilidad en fechas', async () => {
    const texto = await http().post('/api/v2/atracciones/search').send({ query: 'Mitad del Mundo' }).expect(200);
    expect(texto.body.data[0].id).toBe('PRhu4UBTWPBC');

    const precio = await http().post('/api/v2/atracciones/search').send({ precio_min: 30, precio_max: 70, idioma_guia: 'Inglés', limit: 50 }).expect(200);
    for (const card of precio.body.data) expect(card.price.adult).toBeGreaterThanOrEqual(30);
    expect(precio.body.data.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['PRhu4UBTWPBC', 'MNDOBOSQUE07']));

    // Chimborazo tiene 10 cupos por turno: con 11 adultos no aparece en las fechas pedidas.
    const fechas = await http().post('/api/v2/atracciones/search').send({ ciudad: 'Riobamba', fecha_inicio: tomorrow(), fecha_fin: addDays(tomorrow(), 2), adult_count: 11 }).expect(200);
    expect(fechas.body.data).toEqual([]);
    // Solo se envía el alias en español: cuenta igual (el `default` del otro campo no lo contradice).
    const alias = await http().post('/api/v2/atracciones/search').send({ ciudad: 'Riobamba', fecha_inicio: tomorrow(), cantidad_adultos: 11 }).expect(200);
    expect(alias.body.data).toEqual([]);
    expect(fechas.body.data).toEqual([]);
    const conCupo = await http().post('/api/v2/atracciones/search').send({ ciudad: 'Riobamba', fecha_inicio: tomorrow(), adult_count: 2 }).expect(200);
    expect(conCupo.body.data.map((c: { id: string }) => c.id)).toEqual(['CHMBRZSOL009']);
  });

  it('POST /search rechaza alias contradictorios, fechas invertidas y propiedades fuera del contrato con 400', async () => {
    const alias = await http().post('/api/v2/atracciones/search').send({ adult_count: 2, cantidad_adultos: 3 }).expect(400);
    expect(alias.body.code).toBe('ALIAS_CONFLICT');
    await http().post('/api/v2/atracciones/search').send({ fecha_inicio: tomorrow(), fecha_fin: todayIn('America/Guayaquil') }).expect(400);
    await http().post('/api/v2/atracciones/search').send({ limit: 500 }).expect(400);
  });

  it('GET /atracciones/{id} acepta código, slug o uuid y responde 404 para lo que no existe', async () => {
    const byCode = await http().get('/api/v2/atracciones/PRhu4UBTWPBC').expect(200);
    const detail = byCode.body;
    expect(detail).toEqual(expect.objectContaining({ id: 'PRhu4UBTWPBC', uuid: 'a1b2c3d4-0002-4000-8000-000000000002', city: 'Quito', guide_languages: ['Español', 'Inglés'] }));
    expect(detail.rating).toEqual(expect.objectContaining({ score: 9.8, review_count: 8, badge_text: 'Excepcional', breakdown: expect.objectContaining({ limpieza: 9.9, cleanliness: 9.9 }) }));
    expect(detail.price).toEqual(expect.objectContaining({ adult: 30, child: 15, senior: 18, infant: 0, student: 22.5 }));
    expect(detail.itinerary[0]).toEqual(expect.objectContaining({ stop_number: 1, time: '09:00 a.m.', hora: '09:00 a.m.' }));
    expect(detail.meeting_point_geo).toEqual(expect.objectContaining({ city: 'Quito', latitude: -0.178652, google_maps_url: 'https://maps.google.com/?q=-0.178652,-78.48312' }));
    expect(detail).toEqual(expect.objectContaining({ permite_paquete: true, porcentaje_descuento_paquete: 15 }));
    expect(detail.proveedor).toEqual(expect.objectContaining({ id: 'proveedor-atracciones-dilan', ruc: '1792348123001' }));

    await http().get('/api/v2/atracciones/quito-city-tour-mitad-del-mundo').expect(200);
    await http().get('/api/v1/atracciones/a1b2c3d4-0002-4000-8000-000000000002').expect(200);
    const missing = await http().get('/api/v2/atracciones/NOEXISTE0000').expect(404);
    expect(missing.body.code).toBe('ATTRACTION_NOT_FOUND');

    // Riobamba no está entre los destinos del acuerdo: no admite paquete.
    const chimborazo = await http().get('/api/v2/atracciones/CHMBRZSOL009').expect(200);
    expect(chimborazo.body).toEqual(expect.objectContaining({ permite_paquete: false, porcentaje_descuento_paquete: 0 }));
  });

  it('GET /{id}/disponibilidad lista los turnos y refleja al instante un cambio en turnos_aforo', async () => {
    const date = tomorrow();
    const res = await http().get('/api/v2/atracciones/PRhu4UBTWPBC/disponibilidad').query({ date }).expect(200);
    expect(res.body).toEqual(expect.objectContaining({ atraccion_id: 'PRhu4UBTWPBC', date, fecha: date, total_available_slots: 75, total_cupos_disponibles: 75 }));
    expect(res.body.time_slots.map((s: { slot_id: string }) => s.slot_id)).toEqual([`slot-${date.replace(/-/g, '')}-0900`, `slot-${date.replace(/-/g, '')}-1030`, `slot-${date.replace(/-/g, '')}-1400`]);
    expect(res.body.time_slots[1]).toEqual(expect.objectContaining({ time: '10:30 a.m.', time_24h: '10:30:00', cupos_totales: 25, cupos_disponibles: 25, estado: 'DISPONIBLE', precio_adulto_slot: 30, precio_nino_slot: 15 }));

    await system.databases.inventory!.query(
      `UPDATE schema_atracciones.turnos_aforo SET cupos_reservados = 23 WHERE atraccion_codigo = 'PRhu4UBTWPBC' AND fecha = $1 AND hora = '10:30'`,
      [date],
    );
    const after = await http().get('/api/v2/atracciones/PRhu4UBTWPBC/disponibilidad').query({ date }).expect(200);
    expect(after.body.time_slots[1]).toEqual(expect.objectContaining({ cupos_disponibles: 2, estado: 'ULTIMOS_CUPOS' }));
    expect(after.body.total_available_slots).toBe(52);
  });

  it('/disponibilidad valida la fecha (400) y la atracción (404)', async () => {
    await http().get('/api/v2/atracciones/PRhu4UBTWPBC/disponibilidad').expect(400);
    await http().get('/api/v2/atracciones/PRhu4UBTWPBC/disponibilidad').query({ date: '25-10-2026' }).expect(400);
    await http().get('/api/v2/atracciones/NOEXISTE0000/disponibilidad').query({ date: tomorrow() }).expect(404);
  });

  it('el acuerdo de promociones se consulta con promotions:read y solo el administrador lo modifica', async () => {
    await http().get('/api/v2/atracciones/promociones/contrato').expect(401);
    const actual = await http().get('/api/v2/atracciones/promociones/contrato').set('X-API-Key', apiKey).expect(200);
    expect(actual.body).toEqual(expect.objectContaining({ proveedor_id: 'proveedor-atracciones-dilan', permite_promociones: true, porcentaje_descuento_maximo: 15, destinos_habilitados: ['Baños', 'Cuenca', 'Galápagos', 'Quito'] }));

    const cambio = { permite_promociones: true, porcentaje_descuento_maximo: 20, destinos_habilitados: ['Quito', 'Riobamba'], vigencia_hasta: '2027-12-31' };
    await http().put('/api/v2/atracciones/promociones/contrato').set('X-API-Key', apiKey).send(cambio).expect(403);
    const admin = await userToken(system, 'admin@tourgirls.test', ['admin']);
    await http().put('/api/v2/atracciones/promociones/contrato').set('Authorization', `Bearer ${admin}`).send({ ...cambio, porcentaje_descuento_maximo: 60 }).expect(400);
    const guardado = await http().put('/api/v2/atracciones/promociones/contrato').set('Authorization', `Bearer ${admin}`).send(cambio).expect(200);
    expect(guardado.body).toEqual(expect.objectContaining({ porcentaje_descuento_maximo: 20, destinos_habilitados: ['Quito', 'Riobamba'] }));

    // El nuevo acuerdo se refleja en el detalle (la caché se invalida).
    const chimborazo = await http().get('/api/v2/atracciones/CHMBRZSOL009').expect(200);
    expect(chimborazo.body).toEqual(expect.objectContaining({ permite_paquete: true, porcentaje_descuento_paquete: 20 }));
  });

  it('GET /atracciones/health agrega la salud de Catalog e Inventory', async () => {
    const res = await http().get('/api/v2/atracciones/health').expect(200);
    expect(res.body).toEqual(expect.objectContaining({ database_connected: true, version: '2.0.0' }));
    expect(['UP', 'DEGRADED']).toContain(res.body.status);
  });

  it('con Inventory detenido, /disponibilidad responde 503 y el health DOWN con 503', async () => {
    await system.stop('inventory');
    const res = await http().get('/api/v2/atracciones/PRhu4UBTWPBC/disponibilidad').query({ date: tomorrow() }).expect(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    const health = await http().get('/api/v2/atracciones/health').expect(503);
    expect(health.body).toEqual(expect.objectContaining({ status: 'DOWN', database_connected: false }));
    // El detalle no documenta 503: un fallo de Inventory se informa como 500.
    await http().get('/api/v2/atracciones/QTOTELEFRQ01').expect(500);
  });
});
