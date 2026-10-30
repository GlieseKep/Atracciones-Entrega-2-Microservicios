import { randomUUID } from 'node:crypto';
import { AppError, type EsbClient } from '@atracciones/platform';
import { SORTS, type PaginationMetadata, type Sort } from '../contract';
import type { AttractionRepository, PublicFilters } from '../persistence/attraction-repository';
import { childrenOf, toCard } from './attraction-mapper';
import { filterAvailable } from './availability';
import { Fields, queryBoolean, queryInteger, queryText } from './fields';
import type { Locations } from './locations';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Criterios ya validados, antes de consultar a Location e Inventory. */
export interface SearchCriteria {
  query: string | null;
  ciudad: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  categoria: string | null;
  incluyeComida: boolean;
  incluyeTransporte: boolean;
  incluyeGuia: boolean;
  precioMin: number | null;
  precioMax: number | null;
  duracionMax: number | null;
  idioma: string | null;
  accesibleSillaRuedas: boolean;
  animalesAsistencia: boolean;
  cancelacionGratuita: boolean;
  sort: Sort;
  page: number;
  limit: number;
}

function validDate(f: Fields, name: string): string | null {
  const text = f.optionalText(name, 10, DATE);
  if (text && Number.isNaN(Date.parse(`${text}T00:00:00Z`))) f.fail(name, 'La fecha no existe.');
  return text;
}

const optionalNumber = (f: Fields, name: string, min?: number) => (f.body[name] === undefined || f.body[name] === null ? null : f.number(name, { min }));

/** `SearchAtraccionesRequestV2`. `adult_count` se valida y no se aplica. */
export function parseSearchBody(body: unknown): SearchCriteria {
  const f = new Fields(body);
  const criteria: SearchCriteria = {
    query: f.optionalText('query', 200),
    ciudad: f.optionalText('ciudad', 80),
    fechaInicio: validDate(f, 'fecha_inicio'),
    fechaFin: validDate(f, 'fecha_fin'),
    categoria: f.optionalText('categoria_id', 40),
    incluyeComida: f.bool('incluye_comida'),
    incluyeTransporte: f.bool('incluye_transporte'),
    incluyeGuia: f.bool('incluye_guia'),
    precioMin: optionalNumber(f, 'precio_min', 0),
    precioMax: optionalNumber(f, 'precio_max', 0),
    duracionMax: f.optionalInteger('duracion_max_horas', { min: 1 }),
    idioma: f.optionalText('idioma_guia', 50),
    accesibleSillaRuedas: f.bool('accesible_silla_ruedas'),
    animalesAsistencia: f.bool('animales_asistencia'),
    cancelacionGratuita: f.bool('cancelacion_gratuita'),
    sort: f.has('sort') ? f.oneOf('sort', SORTS) : 'POPULARITY',
    page: f.integer('page', { min: 1 }, 1),
    limit: f.integer('limit', { min: 1, max: 50 }, 10),
  };
  f.optionalInteger('adult_count', { min: 1 });
  f.optionalInteger('cantidad_adultos', { min: 1 });
  if (criteria.precioMin !== null && criteria.precioMax !== null && criteria.precioMin > criteria.precioMax) f.fail('precio_max', 'Debe ser mayor o igual que precio_min.');
  if (criteria.fechaInicio && criteria.fechaFin && criteria.fechaFin < criteria.fechaInicio) f.fail('fecha_fin', 'Debe ser igual o posterior a fecha_inicio.');
  f.done();
  return criteria;
}

/** Filtros de `GET /atracciones`. */
export function parseListQuery(query: Record<string, unknown>): SearchCriteria {
  if (query.sort !== undefined && !SORTS.includes(query.sort as Sort)) {
    throw AppError.validation(`'sort' debe ser ${SORTS.join(', ')}.`, [{ name: 'sort', reason: 'Valor no permitido.' }]);
  }
  return {
    query: null,
    ciudad: queryText(query.city),
    fechaInicio: null,
    fechaFin: null,
    categoria: queryText(query.categoria_id),
    incluyeComida: queryBoolean(query.incluye_comida, 'incluye_comida') === true,
    incluyeTransporte: queryBoolean(query.incluye_transporte, 'incluye_transporte') === true,
    incluyeGuia: queryBoolean(query.incluye_guia, 'incluye_guia') === true,
    precioMin: null,
    precioMax: null,
    duracionMax: null,
    idioma: null,
    accesibleSillaRuedas: false,
    animalesAsistencia: false,
    cancelacionGratuita: false,
    sort: (query.sort as Sort | undefined) ?? 'POPULARITY',
    page: queryInteger(query.page, 'page', 1, Number.MAX_SAFE_INTEGER),
    limit: queryInteger(query.limit, 'limit', 10, 50),
  };
}

export const paginationOf = (total: number, page: number, limit: number): PaginationMetadata => ({
  total_results: total,
  page,
  limit,
  total_pages: Math.ceil(total / limit),
});

export class AttractionSearch {
  constructor(
    private readonly attractions: AttractionRepository,
    private readonly locations: Locations,
    private readonly esb: EsbClient,
  ) {}

  async run(criteria: SearchCriteria) {
    const filters: PublicFilters = {
      query: criteria.query,
      queryCityIds: criteria.query ? await this.locations.tryResolve(criteria.query) : [],
      cityIds: criteria.ciudad ? await this.locations.resolve(criteria.ciudad) : null,
      categoria: criteria.categoria,
      incluyeComida: criteria.incluyeComida,
      incluyeTransporte: criteria.incluyeTransporte,
      incluyeGuia: criteria.incluyeGuia,
      precioMin: criteria.precioMin,
      precioMax: criteria.precioMax,
      duracionMax: criteria.duracionMax,
      idioma: criteria.idioma,
      accesibleSillaRuedas: criteria.accesibleSillaRuedas,
      animalesAsistencia: criteria.animalesAsistencia,
      cancelacionGratuita: criteria.cancelacionGratuita,
      codigos: null,
    };
    // Se filtra por fechas antes de paginar, para que el total y las páginas sean correctos.
    if (criteria.fechaInicio || criteria.fechaFin) {
      const start = (criteria.fechaInicio ?? criteria.fechaFin) as string;
      const end = criteria.fechaFin ?? start;
      filters.codigos = await filterAvailable(this.esb, await this.attractions.matchingCodes(filters), start, end);
    }
    const { total, rows } = await this.attractions.search(filters, criteria.sort, criteria.page, criteria.limit);
    const [cities, children] = await Promise.all([
      this.locations.names(rows.map((row) => row.ciu_id)),
      this.attractions.children(rows.map((row) => row.atr_id)),
    ]);
    return {
      request_id: `req-atr-${randomUUID()}`,
      metadata: paginationOf(total, criteria.page, criteria.limit),
      data: rows.map((row) =>
        toCard(row, cities.get(row.ciu_id) ?? '', childrenOf(children, row.atr_id).fotos.map((foto) => foto.fot_url)),
      ),
    };
  }
}
