import type { Attraction, SearchSortBy } from '@/types/attraction';
import type { IsoDate } from '@/types/api';
import { isValidIsoDate } from '@/utils/dates';
import { durationToMinutes } from '@/utils/formatters';

/** Filtros del listado, serializados en la URL con claves en español para que sean compartibles. */

export type DurationBucket = 'hasta-1h' | '1-4h' | '4h-1d' | 'varios-dias';
export type SortOption = 'destacados' | 'precio-asc' | 'precio-desc' | 'valoracion';

export interface CatalogFilters {
  q: string;
  city: string;
  categories: string[];
  date: IsoDate | '';
  maxPrice: number | null;
  durations: DurationBucket[];
  minRating: number | null;
  language: string;
  freeCancellation: boolean;
  sort: SortOption;
  page: number;
}

export const PAGE_SIZE = 9;

export const DEFAULT_FILTERS: CatalogFilters = {
  q: '',
  city: '',
  categories: [],
  date: '',
  maxPrice: null,
  durations: [],
  minRating: null,
  language: '',
  freeCancellation: false,
  sort: 'destacados',
  page: 1,
};

export const DURATION_OPTIONS: { value: DurationBucket; label: string; min: number; max: number }[] = [
  { value: 'hasta-1h', label: 'Hasta 1 hora', min: 0, max: 60 },
  { value: '1-4h', label: 'De 1 a 4 horas', min: 61, max: 240 },
  { value: '4h-1d', label: 'De 4 horas a 1 día', min: 241, max: 1440 },
  { value: 'varios-dias', label: 'Varios días', min: 1441, max: Number.POSITIVE_INFINITY },
];

export const SORT_OPTIONS: { value: SortOption; label: string; api: SearchSortBy }[] = [
  { value: 'destacados', label: 'Destacados', api: 'most_popular' },
  { value: 'precio-asc', label: 'Precio (de menor a mayor)', api: 'price_asc' },
  { value: 'precio-desc', label: 'Precio (de mayor a menor)', api: 'price_desc' },
  { value: 'valoracion', label: 'Valoración', api: 'rating_desc' },
];

const list = (value: string | null) => (value ? value.split(',').filter(Boolean) : []);
const num = (value: string | null) => {
  const n = value === null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function parseFilters(params: URLSearchParams): CatalogFilters {
  const sort = params.get('orden') as SortOption | null;
  const date = params.get('fecha') ?? '';
  return {
    q: params.get('q')?.trim() ?? '',
    city: params.get('ciudad')?.trim() ?? '',
    categories: list(params.get('categorias')),
    date: isValidIsoDate(date) ? date : '',
    maxPrice: num(params.get('precioMax')),
    durations: list(params.get('duracion')).filter((d): d is DurationBucket =>
      DURATION_OPTIONS.some((o) => o.value === d),
    ),
    minRating: num(params.get('valoracion')),
    language: params.get('idioma') ?? '',
    freeCancellation: params.get('cancelacion') === 'gratis',
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? (sort as SortOption) : 'destacados',
    page: Math.max(1, Math.floor(num(params.get('pagina')) ?? 1)),
  };
}

export function serializeFilters(filters: Partial<CatalogFilters>): URLSearchParams {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.city) params.set('ciudad', f.city);
  if (f.categories.length) params.set('categorias', f.categories.join(','));
  if (f.date) params.set('fecha', f.date);
  if (f.maxPrice) params.set('precioMax', String(f.maxPrice));
  if (f.durations.length) params.set('duracion', f.durations.join(','));
  if (f.minRating) params.set('valoracion', String(f.minRating));
  if (f.language) params.set('idioma', f.language);
  if (f.freeCancellation) params.set('cancelacion', 'gratis');
  if (f.sort !== 'destacados') params.set('orden', f.sort);
  if (f.page > 1) params.set('pagina', String(f.page));
  return params;
}

export const activeFilterCount = (f: CatalogFilters) =>
  f.categories.length +
  f.durations.length +
  (f.city ? 1 : 0) +
  (f.maxPrice ? 1 : 0) +
  (f.minRating ? 1 : 0) +
  (f.language ? 1 : 0) +
  (f.freeCancellation ? 1 : 0);

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function matchesFilters(a: Attraction, f: CatalogFilters): boolean {
  if (f.q) {
    const haystack = normalize(
      [a.name, a.longDescription, ...a.categories, ...a.locations.map((l) => l.city)].join(' '),
    );
    if (!normalize(f.q).split(/\s+/).every((term) => haystack.includes(term))) return false;
  }
  if (f.city && !a.locations.some((l) => normalize(l.city) === normalize(f.city))) return false;
  if (f.categories.length && !f.categories.some((c) => a.categories.includes(c))) return false;
  if (f.maxPrice && a.price.total > f.maxPrice) return false;
  if (f.minRating && (a.ratings?.score ?? 0) < f.minRating) return false;
  if (f.language && !a.supportedLanguages.includes(f.language)) return false;
  if (f.freeCancellation && !a.freeCancellation) return false;
  if (f.durations.length) {
    const minutes = durationToMinutes(a.duration);
    if (minutes === null) return false;
    const inBucket = DURATION_OPTIONS.filter((o) => f.durations.includes(o.value)).some(
      (o) => minutes >= o.min && minutes <= o.max,
    );
    if (!inBucket) return false;
  }
  return true;
}

/** "Destacados" pondera valoración y número de opiniones, similar al orden por defecto de Viator. */
const popularity = (a: Attraction) => (a.ratings?.score ?? 0) * Math.log10((a.ratings?.numberOfReviews ?? 0) + 10);

export function sortAttractions(items: Attraction[], sort: SortOption): Attraction[] {
  const copy = [...items];
  switch (sort) {
    case 'precio-asc':
      return copy.sort((a, b) => a.price.total - b.price.total);
    case 'precio-desc':
      return copy.sort((a, b) => b.price.total - a.price.total);
    case 'valoracion':
      return copy.sort((a, b) => (b.ratings?.score ?? 0) - (a.ratings?.score ?? 0));
    default:
      return copy.sort((a, b) => popularity(b) - popularity(a));
  }
}

export interface FilteredPage {
  items: Attraction[];
  total: number;
  totalPages: number;
  page: number;
}

export function applyFilters(all: Attraction[], f: CatalogFilters, pageSize = PAGE_SIZE): FilteredPage {
  const filtered = sortAttractions(
    all.filter((a) => matchesFilters(a, f)),
    f.sort,
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(f.page, totalPages);
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    totalPages,
    page,
  };
}

/** Valores únicos para construir las facetas del panel de filtros. */
export function facets(all: Attraction[]) {
  const count = (values: string[]) => {
    const map = new Map<string, number>();
    values.forEach((v) => map.set(v, (map.get(v) ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };
  return {
    categories: count(all.flatMap((a) => a.categories)),
    cities: count(all.flatMap((a) => [...new Set(a.locations.map((l) => l.city))])),
    languages: count(all.flatMap((a) => a.supportedLanguages)),
    maxPrice: Math.ceil(Math.max(0, ...all.map((a) => a.price.total))),
  };
}
