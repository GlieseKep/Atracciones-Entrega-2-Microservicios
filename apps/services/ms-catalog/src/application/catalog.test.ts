import { AppError, createLogger, type EsbClient, type EventEnvelope } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { AttractionChildren, AttractionRepository, AttractionRow, PublicFilters } from '../persistence/attraction-repository';
import type { GuideRepository } from '../persistence/guide-repository';
import type { OperatorRepository } from '../persistence/operator-repository';
import { isReservedSlug, parseAttraction, slugify } from './attraction-input';
import { childrenOf, toCard, toDetail } from './attraction-mapper';
import { AttractionService } from './attraction-service';
import { filterAvailable } from './availability';
import { EVENT_PATTERNS, eventHandler } from './event-handlers';
import { Fields, queryBoolean, queryInteger } from './fields';
import { Locations } from './locations';
import type { Permissions } from './permissions';
import { AttractionSearch, paginationOf, parseListQuery, parseSearchBody } from './search';

process.env.LOG_SILENT = 'true';
const logger = createLogger('pruebas');

const row = (overrides: Partial<AttractionRow> = {}): AttractionRow => ({
  atr_id: '1', atr_codigo: 'PRhu4UBTWPBC', atr_uuid: 'u-1', atr_nombre: 'Tour Baños', atr_slug: 'tour-banos', atr_descripcion: 'Descripción', atr_descripcion_corta: null,
  atr_tipo: 'TOUR', atr_estado: 'PUBLICADA', atr_latitud: '-1.3964', atr_longitud: '-78.4247', atr_direccion: null, atr_punto_encuentro: 'Parque central',
  atr_instrucciones_llegada: null, atr_duracion_horas: '1.5', atr_moneda: 'USD', atr_precio_adulto: '45.00', atr_precio_nino: '22.50', atr_precio_senior: '31.50',
  atr_precio_infante: '0.00', atr_precio_estudiante: null, ciu_id: 5, ope_id: '2', atr_incluye_comida: true, atr_incluye_transporte: false, atr_incluye_guia: true,
  atr_accesible_silla_ruedas: true, atr_accesible_carriola: false, atr_admite_animales_asistencia: true, atr_cancelacion_gratuita: true, atr_horas_cancelacion: 24,
  atr_politica_cancelacion: null, atr_permite_paquete: true, atr_porcentaje_descuento_paquete: '10', atr_destacada: false, atr_calificacion_promedio: '9.2',
  atr_calif_limpieza: '9', atr_calif_servicio: '9.5', atr_calif_calidad_precio: '8.8', atr_calif_puntualidad: '9.1', atr_numero_resenas: 12,
  ope_codigo: 'OPE-1', ope_nombre: 'Operador', ope_ruc: null, ope_telefono: null, ope_correo: null, ...overrides,
});
const EMPTY: AttractionChildren = { fotos: [], itinerario: [], inclusiones: [], idiomas: [], categorias: [] };

const esbStub = (impl: (service: string, op: string, input: Record<string, unknown>) => unknown) => {
  const call = jest.fn(async (s: string, o: string, i: object = {}) => impl(s, o, i as Record<string, unknown>));
  return { esb: { call } as unknown as EsbClient, call };
};

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ms-catalog/search · P3 búsqueda avanzada', () => {
  it('valores por defecto: POPULARITY, página 1, 10 por página', () => {
    expect(parseSearchBody({})).toMatchObject({ sort: 'POPULARITY', page: 1, limit: 10, ciudad: null, incluyeComida: false });
  });

  it('cada filtro del contrato se lee del cuerpo', () => {
    const c = parseSearchBody({ query: ' baños ', ciudad: 'Baños', categoria_id: 'AVENTURA', incluye_comida: true, incluye_transporte: true, incluye_guia: true, precio_min: 10, precio_max: 50, duracion_max_horas: 4, idioma_guia: 'Inglés', accesible_silla_ruedas: true, animales_asistencia: true, cancelacion_gratuita: true, sort: 'PRICE_ASC', page: 2, limit: 20 });
    expect(c).toEqual(expect.objectContaining({ query: 'baños', ciudad: 'Baños', categoria: 'AVENTURA', incluyeComida: true, incluyeTransporte: true, incluyeGuia: true, precioMin: 10, precioMax: 50, duracionMax: 4, idioma: 'Inglés', accesibleSillaRuedas: true, animalesAsistencia: true, cancelacionGratuita: true, sort: 'PRICE_ASC', page: 2, limit: 20 }));
  });

  it('precio_min mayor que precio_max → 400 en precio_max', () => {
    expect(() => parseSearchBody({ precio_min: 50, precio_max: 10 })).toThrow(expect.objectContaining({ invalidParams: [expect.objectContaining({ name: 'precio_max' })] }));
  });

  it('fecha_fin anterior a fecha_inicio, fecha inexistente y sort desconocido → 400 con todos los errores', () => {
    try {
      parseSearchBody({ fecha_inicio: '2026-11-25', fecha_fin: '2026-11-20', sort: 'RANDOM', limit: 51 });
      throw new Error('no lanzó');
    } catch (e) {
      expect((e as AppError).invalidParams?.map((p) => p.name).sort()).toEqual(['fecha_fin', 'limit', 'sort']);
    }
  });

  it('tipos inválidos (booleano como texto) → 400', () => {
    expect(() => parseSearchBody({ incluye_comida: 'si' })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('listado: query string con city, banderas y paginación', () => {
    expect(parseListQuery({ city: 'Quito', incluye_guia: 'true', page: '3', limit: '5' })).toMatchObject({ ciudad: 'Quito', incluyeGuia: true, page: 3, limit: 5 });
    expect(() => parseListQuery({ sort: 'X' })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('paginación: total_pages redondea hacia arriba', () => {
    expect(paginationOf(21, 2, 10)).toEqual({ total_results: 21, page: 2, limit: 10, total_pages: 3 });
    expect(paginationOf(0, 1, 10).total_pages).toBe(0);
  });

  function searchWith(rows: AttractionRow[], codesAvailable: string[] = []) {
    const search = jest.fn(async (_f: PublicFilters) => ({ total: rows.length, rows }));
    const attractions = { search, matchingCodes: jest.fn(async () => rows.map((r) => r.atr_codigo)), children: jest.fn(async () => EMPTY) } as unknown as AttractionRepository;
    const { esb, call } = esbStub((_s, op) => (op === 'resolveCities' ? { resueltas: [{ nombre_enviado: 'x', ciudades: [{ id: 5, nombre: 'Baños' }] }], no_encontrados: [] } : op === 'getCities' ? [{ id: 5, nombre: 'Baños' }] : { atraccion_ids: codesAvailable }));
    return { run: new AttractionSearch(attractions, new Locations(esb, logger), esb), search, call };
  }

  it('ciudad se resuelve en Location y la tarjeta trae el nombre de la ciudad', async () => {
    const { run, search } = searchWith([row()]);
    const res = await run.run(parseSearchBody({ ciudad: 'Baños' }));
    expect(search.mock.calls[0][0]).toMatchObject({ cityIds: [5], codigos: null });
    expect(res.data[0]).toMatchObject({ id: 'PRhu4UBTWPBC', city: 'Baños', ciudad: 'Baños' });
    expect(res.request_id).toMatch(/^req-atr-/);
  });

  it('con fechas se filtra por disponibilidad en Inventory antes de paginar', async () => {
    const { run, search, call } = searchWith([row()], ['PRhu4UBTWPBC']);
    await run.run(parseSearchBody({ fecha_inicio: '2026-11-25' }));
    expect(call).toHaveBeenCalledWith('inventory', 'filterAvailableAttractions', { atraccion_ids: ['PRhu4UBTWPBC'], fecha_inicio: '2026-11-25', fecha_fin: '2026-11-25' });
    expect(search.mock.calls[0][0].codigos).toEqual(['PRhu4UBTWPBC']);
  });

  it('sin resultados → data vacía y total 0', async () => {
    const { run } = searchWith([]);
    await expect(run.run(parseSearchBody({}))).resolves.toMatchObject({ data: [], metadata: { total_results: 0 } });
  });
});

describe('ms-catalog/attraction-mapper · tarjeta y ficha (P4, P5)', () => {
  it('tarifas por edad con alias y estudiante solo si existe', () => {
    const card = toCard(row(), 'Baños', []);
    expect(card.price).toEqual({ currency: 'USD', adult: 45, child: 22.5, senior: 31.5, infant: 0, adulto: 45, nino: 22.5, tercera_edad: 31.5, infante: 0, moneda: 'USD' });
    expect(toCard(row({ atr_precio_estudiante: '30' }), '', []).price).toMatchObject({ student: 30, estudiante: 30 });
  });

  it('valoración con insignia según el promedio; sin reseñas no hay insignia', () => {
    expect(toCard(row(), '', []).rating).toEqual({ score: 9.2, review_count: 12, badge_text: 'Excepcional' });
    expect(toCard(row({ atr_calificacion_promedio: '8.1' }), '', []).rating.badge_text).toBe('Muy bueno');
    expect(toCard(row({ atr_numero_resenas: 0 }), '', []).rating).not.toHaveProperty('badge_text');
  });

  it('banderas incluye_* y duración legible', () => {
    expect(toCard(row(), '', []).inclusions).toEqual({ includes_food: true, includes_transport: false, includes_guide: true, incluye_comida: true, incluye_transporte: false, incluye_guia: true });
    expect(toCard(row(), '', []).duration).toBe('1.5 horas');
  });

  it('ficha: itinerario con hora 12 h y alias, desglose de valoraciones', () => {
    const children: AttractionChildren = { ...EMPTY, itinerario: [{ atr_id: '1', iti_numero_parada: 1, iti_hora: '09:00:00', iti_titulo: 'Salida', iti_descripcion: null, iti_duracion_minutos: 30, iti_nombre_ubicacion: 'Plaza' }] };
    const detail = toDetail(row(), 'Baños', children);
    expect(detail.itinerary[0]).toEqual({ stop_number: 1, time: '09:00 a.m.', title: 'Salida', duration_minutes: 30, location_name: 'Plaza', numero_parada: 1, hora: '09:00 a.m.', titulo: 'Salida', duracion_minutos: 30, nombre_ubicacion: 'Plaza' });
    expect(detail.rating.breakdown).toMatchObject({ limpieza: 9, servicio: 9.5, calidad_precio: 8.8, puntualidad: 9.1, cleanliness: 9 });
  });

  it('ficha: punto de encuentro con coordenadas y enlace de Google Maps; dirección cae al punto de encuentro', () => {
    const geo = toDetail(row(), 'Baños', EMPTY).meeting_point_geo;
    expect(geo).toMatchObject({ address: 'Parque central', latitude: -1.3964, longitude: -78.4247, google_maps_url: 'https://maps.google.com/?q=-1.396400,-78.424700' });
  });

  it('campos nulos no aparecen (descripción corta, instrucciones, ruc del proveedor)', () => {
    const detail = toDetail(row(), '', EMPTY);
    expect(toCard(row(), '', [])).not.toHaveProperty('short_description');
    expect(detail.meeting_point_geo).not.toHaveProperty('arrival_instructions');
    expect(detail.proveedor).toEqual({ id: 'OPE-1', nombre_comercial: 'Operador' });
  });

  it('childrenOf separa los datos cargados en lote por atracción', () => {
    const all: AttractionChildren = { ...EMPTY, fotos: [{ atr_id: '1', fot_url: 'a', fot_alt: '', fot_orden: 0 }, { atr_id: '2', fot_url: 'b', fot_alt: '', fot_orden: 0 }] };
    expect(childrenOf(all, '2').fotos.map((f) => f.fot_url)).toEqual(['b']);
  });
});

describe('ms-catalog/attraction-service · consulta pública (P5, P7)', () => {
  function service(found: AttractionRow | null, guia: { gui_id: number; nombre: string } | null = { gui_id: 4, nombre: 'Carlos' }) {
    const attractions = { findByPublicId: jest.fn(async () => found), children: jest.fn(async () => EMPTY) } as unknown as AttractionRepository;
    const guides = { forReservation: jest.fn(async () => guia) } as unknown as GuideRepository;
    const { esb } = esbStub(() => [{ id: 5, nombre: 'Baños' }]);
    return new AttractionService({} as DataSource, attractions, {} as OperatorRepository, guides, new Locations(esb, logger), {} as Permissions, esb, logger);
  }

  it('ficha de una atracción publicada', async () => {
    await expect(service(row()).publicDetail('PRhu4UBTWPBC')).resolves.toMatchObject({ id: 'PRhu4UBTWPBC', city: 'Baños' });
  });

  it('inexistente o no publicada → 404 ATTRACTION_NOT_FOUND', async () => {
    await expect(service(null).publicDetail('X')).rejects.toMatchObject({ status: 404, code: 'ATTRACTION_NOT_FOUND' });
    await expect(service(row({ atr_estado: 'BORRADOR' as AttractionRow['atr_estado'] })).reference('X')).rejects.toMatchObject({ status: 404 });
  });

  it('referencia para la compra: atr_id numérico, código y nombre', async () => {
    await expect(service(row()).reference('PRhu4UBTWPBC')).resolves.toEqual({ atr_id: 1, id: 'PRhu4UBTWPBC', slug: 'tour-banos', nombre: 'Tour Baños' });
  });

  it('logística: guía pedido que no sirve → 404 GUIDE_NOT_FOUND; sin pedir guía puede quedar null', async () => {
    await expect(service(row(), null).logistics('PRhu4UBTWPBC', 9)).rejects.toMatchObject({ status: 404, code: 'GUIDE_NOT_FOUND' });
    await expect(service(row(), null).logistics('PRhu4UBTWPBC', null)).resolves.toMatchObject({ guia: null, punto_encuentro: 'Parque central', deadline_hours: 24 });
  });
});

describe('ms-catalog/attraction-input · alta y edición', () => {
  const valid = { name: 'Tour', description: 'Desc', tipo: 'GUIDED_TOUR', latitude: -1, longitude: -78, duration_hours: 2, ciu_id: 5, operador: 'OPE-1', categorias: ['AVENTURA'] };

  it('entrada válida con alias en español de las banderas', () => {
    expect(parseAttraction({ ...valid, inclusions: { incluye_comida: true } })).toMatchObject({ nombre: 'Tour', incluyeComida: true, inclusiones: [], fotos: [] });
  });
  it('descuento de paquete sin permite_paquete → 400', () => {
    expect(() => parseAttraction({ ...valid, porcentaje_descuento_paquete: 10 })).toThrow(expect.objectContaining({ invalidParams: expect.arrayContaining([expect.objectContaining({ name: 'porcentaje_descuento_paquete' })]) }));
  });
  it('coordenadas fuera de rango y categorías vacías → 400', () => {
    expect(() => parseAttraction({ ...valid, latitude: 91, categorias: [] })).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('itinerario con hora inválida indica la parada', () => {
    expect(() => parseAttraction({ ...valid, itinerario: [{ stop_number: 1, time: '25:00', title: 'x', duration_minutes: 5 }] })).toThrow(expect.objectContaining({ invalidParams: expect.arrayContaining([expect.objectContaining({ name: 'itinerario[0].time' })]) }));
  });
  it('slugify quita tildes y símbolos; slugs reservados por rutas del contrato', () => {
    expect(slugify('Baños: Aventura ¡Extrema!')).toBe('banos-aventura-extrema');
    expect(isReservedSlug('search')).toBe(true);
    expect(isReservedSlug('tour-banos')).toBe(false);
  });
});

describe('ms-catalog/availability, locations y fields', () => {
  it('filterAvailable sin códigos no llama a Inventory', async () => {
    const { esb, call } = esbStub(() => ({}));
    await expect(filterAvailable(esb, [], '2026-11-25', '2026-11-25')).resolves.toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
  it('filterAvailable devuelve lo que responde Inventory (vacío si no trae lista)', async () => {
    await expect(filterAvailable(esbStub(() => ({})).esb, ['A'], 'a', 'b')).resolves.toEqual([]);
  });
  it('fecha_inicio sola usa la misma fecha como fin', async () => {
    const { esb, call } = esbStub(() => ({ atraccion_ids: ['A'] }));
    await filterAvailable(esb, ['A'], '2026-11-25', '2026-11-25');
    expect(call.mock.calls[0][2]).toMatchObject({ fecha_fin: '2026-11-25' });
  });
  it('locations: nombres en caché 10 min; si Location cae se usan los conocidos', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    let down = false;
    const { esb, call } = esbStub(() => { if (down) throw AppError.unavailable(); return [{ id: 5, nombre: 'Baños' }]; });
    const locations = new Locations(esb, logger);
    await locations.names([5]);
    await locations.names([5]);
    expect(call).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-11-20T12:11:00Z'));
    down = true;
    await expect(locations.names([5])).resolves.toEqual(new Map([[5, 'Baños']]));
  });
  it('locations: tryResolve no tumba la búsqueda si Location falla; ciudad inexistente → 422', async () => {
    const failing = new Locations(esbStub(() => { throw AppError.unavailable(); }).esb, logger);
    await expect(failing.tryResolve('x')).resolves.toEqual([]);
    await expect(new Locations(esbStub(() => []).esb, logger).assertCity(99)).rejects.toMatchObject({ status: 422, code: 'CITY_NOT_FOUND' });
  });
  it('locations: resolve junta las ciudades de una provincia', async () => {
    const { esb } = esbStub(() => ({ resueltas: [{ nombre_enviado: 'Pichincha', ciudades: [{ id: 1, nombre: 'Quito' }, { id: 2, nombre: 'Cayambe' }] }], no_encontrados: [] }));
    await expect(new Locations(esb, logger).resolve('Pichincha')).resolves.toEqual([1, 2]);
  });
  it('fields acumula errores con prefijo y queryBoolean/queryInteger validan la query', () => {
    const f = new Fields({ a: 1 }, 'x.');
    f.text('a', 5);
    f.bool('b');
    expect(() => f.done()).toThrow(expect.objectContaining({ invalidParams: [{ name: 'x.a', reason: expect.any(String) }] }));
    expect(queryBoolean('false', 'b')).toBe(false);
    expect(() => queryBoolean('si', 'b')).toThrow();
    expect(() => queryInteger('0', 'page', 1, 10)).toThrow();
  });
  it('fields: lista de texto sin repetidos', () => {
    expect(new Fields({ l: ['a', 'a', 'b'] }).stringList('l')).toEqual(['a', 'b']);
  });
});

describe('ms-catalog/event-handlers · proyección de tarifas y reseñas', () => {
  const ev = (type: string, data: Record<string, unknown>): EventEnvelope => ({ specversion: '1.0', id: 'e', source: '', type, subject: '', time: '', correlation_id: '', data });
  const repo = (applied = true) => ({ applyRatings: jest.fn(async () => applied), applyPrices: jest.fn(async () => applied) }) as unknown as AttractionRepository & { applyRatings: jest.Mock; applyPrices: jest.Mock };

  it('suscripción a RESENA_PUBLICADA y TARIFA_ACTUALIZADA', () => {
    expect(EVENT_PATTERNS).toEqual(['review.RESENA_PUBLICADA', 'pricing.TARIFA_ACTUALIZADA']);
  });

  it('TARIFA_ACTUALIZADA actualiza los precios de la atracción (estudiante opcional)', async () => {
    const r = repo();
    await eventHandler(r, logger)(ev('TARIFA_ACTUALIZADA', { attraction_id: 'PRhu4UBTWPBC', current_prices: { currency: 'USD', adult: 50, child: 25, senior: 35, infant: 0 } }));
    expect(r.applyPrices).toHaveBeenCalledWith('PRhu4UBTWPBC', { moneda: 'USD', adulto: 50, nino: 25, senior: 35, infante: 0, estudiante: null });
  });

  it('RESENA_PUBLICADA actualiza promedio, desglose y cantidad', async () => {
    const r = repo();
    await eventHandler(r, logger)(ev('RESENA_PUBLICADA', { atr_id: 1, promedio: 9, limpieza: 9, servicio: 9, calidad_precio: 8, puntualidad: 10, numero_resenas: 13 }));
    expect(r.applyRatings).toHaveBeenCalledWith(1, { promedio: 9, limpieza: 9, servicio: 9, calidadPrecio: 8, puntualidad: 10, numeroResenas: 13 });
  });

  it('evento repetido aplica los mismos valores absolutos (idempotente)', async () => {
    const r = repo();
    const handler = eventHandler(r, logger);
    const event = ev('TARIFA_ACTUALIZADA', { attraction_id: 'A', current_prices: { adult: 1, child: 1, senior: 1, infant: 0 } });
    await handler(event);
    await handler(event);
    expect(r.applyPrices.mock.calls[0]).toEqual(r.applyPrices.mock.calls[1]);
  });

  it('evento incompleto o de atracción desconocida se descarta sin error', async () => {
    const r = repo(false);
    await expect(eventHandler(r, logger)(ev('RESENA_PUBLICADA', { atr_id: 1 }))).resolves.toBeUndefined();
    expect(r.applyRatings).not.toHaveBeenCalled();
    await expect(eventHandler(r, logger)(ev('TARIFA_ACTUALIZADA', { attraction_id: 'X', current_prices: { adult: 1, child: 1, senior: 1, infant: 0 } }))).resolves.toBeUndefined();
  });
});
