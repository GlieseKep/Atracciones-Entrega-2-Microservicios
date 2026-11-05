import type { IsoDate } from '@/types/api';
import type { SearchRequest, SearchSort } from '@/types/attraction';
import { isValidIsoDate } from '@/utils/dates';

/**
 * Filtros del listado, serializados en la URL con claves en español para que sean compartibles. Todos viajan a
 * `POST /atracciones/search`: el servidor filtra, ordena y pagina.
 */

export type SortOption = 'destacados' | 'precio-asc' | 'precio-desc' | 'valoracion';
export type Inclusion = 'comida' | 'transporte' | 'guia';

export interface CatalogFilters {
  q: string;
  city: string;
  /** Id de categoría de ms-catalog (`cat-aventura-100`). */
  category: string;
  date: IsoDate | '';
  maxPrice: number | null;
  maxHours: number | null;
  language: string;
  freeCancellation: boolean;
  includes: Inclusion[];
  accessible: boolean;
  sort: SortOption;
  page: number;
}

export const PAGE_SIZE = 12;

export const DEFAULT_FILTERS: CatalogFilters = {
  q: '',
  city: '',
  category: '',
  date: '',
  maxPrice: null,
  maxHours: null,
  language: '',
  freeCancellation: false,
  includes: [],
  accessible: false,
  sort: 'destacados',
  page: 1,
};

export const DURATION_OPTIONS = [
  { value: 2, label: 'Hasta 2 horas' },
  { value: 4, label: 'Hasta 4 horas (medio día)' },
  { value: 8, label: 'Hasta 8 horas (día completo)' },
];

export const INCLUSION_OPTIONS: { value: Inclusion; label: string }[] = [
  { value: 'comida', label: 'Incluye alimentación' },
  { value: 'transporte', label: 'Incluye transporte' },
  { value: 'guia', label: 'Con guía certificado' },
];

export const SORT_OPTIONS: { value: SortOption; label: string; api: SearchSort }[] = [
  { value: 'destacados', label: 'Destacados', api: 'POPULARITY' },
  { value: 'precio-asc', label: 'Precio (de menor a mayor)', api: 'PRICE_ASC' },
  { value: 'precio-desc', label: 'Precio (de mayor a menor)', api: 'PRICE_DESC' },
  { value: 'valoracion', label: 'Valoración', api: 'RATING_DESC' },
];

const num = (value: string | null) => {
  const n = value === null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function parseFilters(params: URLSearchParams): CatalogFilters {
  const sort = params.get('orden') as SortOption | null;
  const date = params.get('fecha') ?? '';
  const includes = (params.get('incluye') ?? '').split(',').filter((v): v is Inclusion => INCLUSION_OPTIONS.some((o) => o.value === v));
  return {
    q: params.get('q')?.trim() ?? '',
    city: params.get('ciudad')?.trim() ?? '',
    category: params.get('categoria')?.trim() ?? '',
    date: isValidIsoDate(date) ? date : '',
    maxPrice: num(params.get('precioMax')),
    maxHours: num(params.get('duracionMax')),
    language: params.get('idioma')?.trim() ?? '',
    freeCancellation: params.get('cancelacion') === 'gratis',
    includes,
    accessible: params.get('accesible') === 'si',
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? (sort as SortOption) : 'destacados',
    page: Math.max(1, Math.floor(num(params.get('pagina')) ?? 1)),
  };
}

export function serializeFilters(filters: Partial<CatalogFilters>): URLSearchParams {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.city) params.set('ciudad', f.city);
  if (f.category) params.set('categoria', f.category);
  if (f.date) params.set('fecha', f.date);
  if (f.maxPrice) params.set('precioMax', String(f.maxPrice));
  if (f.maxHours) params.set('duracionMax', String(f.maxHours));
  if (f.language) params.set('idioma', f.language);
  if (f.freeCancellation) params.set('cancelacion', 'gratis');
  if (f.includes.length) params.set('incluye', f.includes.join(','));
  if (f.accessible) params.set('accesible', 'si');
  if (f.sort !== 'destacados') params.set('orden', f.sort);
  if (f.page > 1) params.set('pagina', String(f.page));
  return params;
}

export const activeFilterCount = (f: CatalogFilters) =>
  f.includes.length +
  (f.city ? 1 : 0) +
  (f.category ? 1 : 0) +
  (f.date ? 1 : 0) +
  (f.maxPrice ? 1 : 0) +
  (f.maxHours ? 1 : 0) +
  (f.language ? 1 : 0) +
  (f.freeCancellation ? 1 : 0) +
  (f.accessible ? 1 : 0);

/** Cuerpo de `POST /atracciones/search` para los filtros de la URL. */
export function toSearchRequest(f: CatalogFilters, pageSize = PAGE_SIZE): SearchRequest {
  return {
    ...(f.q ? { query: f.q } : {}),
    ...(f.city ? { ciudad: f.city } : {}),
    ...(f.category ? { categoria_id: f.category } : {}),
    ...(f.date ? { fecha_inicio: f.date, fecha_fin: f.date } : {}),
    ...(f.maxPrice ? { precio_max: f.maxPrice } : {}),
    ...(f.maxHours ? { duracion_max_horas: f.maxHours } : {}),
    ...(f.language ? { idioma_guia: f.language } : {}),
    ...(f.freeCancellation ? { cancelacion_gratuita: true } : {}),
    ...(f.includes.includes('comida') ? { incluye_comida: true } : {}),
    ...(f.includes.includes('transporte') ? { incluye_transporte: true } : {}),
    ...(f.includes.includes('guia') ? { incluye_guia: true } : {}),
    ...(f.accessible ? { accesible_silla_ruedas: true } : {}),
    sort: SORT_OPTIONS.find((o) => o.value === f.sort)?.api ?? 'POPULARITY',
    page: f.page,
    limit: pageSize,
  };
}
