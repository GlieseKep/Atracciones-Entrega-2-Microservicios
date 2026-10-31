import * as attractionsApi from '@/api/attractions';
import * as availabilityApi from '@/api/availability';
import { env } from '@/config/env';
import { useAuthStore } from '@/stores/authStore';
import type { IsoDate } from '@/types/api';
import type { Attraction, Availability, AvailabilitySlot } from '@/types/attraction';
import { ApiError } from '@/utils/api';
import { today } from '@/utils/dates';
import { DEMO_ATTRACTIONS } from './demoCatalog';
import { SORT_OPTIONS, type CatalogFilters } from './filters';

export type CatalogDataSource = 'api' | 'demo';

/**
 * La lectura del catálogo es pública en el API, así que se consulta siempre (con o sin sesión). El catálogo de
 * demostración solo se usa con `VITE_CATALOG_SOURCE=demo`, para trabajar en la web sin el backend.
 */
export function resolveCatalogSource(): CatalogDataSource {
  return env.catalogSource === 'demo' ? 'demo' : 'api';
}

const MAX_API_PAGES = 5;

/**
 * Obtiene el conjunto de atracciones candidato. Ciudad, fechas, valoración y orden se envían al API;
 * categoría, precio, duración, idioma y cancelación no existen en `POST /atracciones/search`
 * y se aplican en el cliente (ver `applyFilters`).
 */
export async function fetchCatalog(filters: CatalogFilters, signal?: AbortSignal): Promise<Attraction[]> {
  if (resolveCatalogSource() === 'demo') return DEMO_ATTRACTIONS;

  const results: Attraction[] = [];
  let nextPage: string | undefined;
  for (let i = 0; i < MAX_API_PAGES; i++) {
    const response = await attractionsApi.searchAttractions(
      {
        cities: filters.city ? [filters.city] : [],
        dates: filters.date ? { startDate: filters.date, endDate: filters.date } : undefined,
        filters: filters.minRating ? { rating: { minimumReviewScore: filters.minRating } } : undefined,
        sort: { by: SORT_OPTIONS.find((o) => o.value === filters.sort)?.api ?? 'most_popular' },
        rows: 100,
        nextPage,
      },
      signal,
    );
    results.push(...response.data);
    nextPage = response.metadata.nextPage ?? undefined;
    if (!nextPage) break;
  }
  return results;
}

export async function fetchAttraction(id: string, signal?: AbortSignal): Promise<Attraction> {
  if (resolveCatalogSource() === 'api') return attractionsApi.getAttraction(id, signal);
  const found = DEMO_ATTRACTIONS.find((a) => a.id === id);
  if (!found) throw new ApiError('notFound', 404);
  return found;
}

/** Con sesión siempre se consulta el API, porque la reserva y la compra se validan contra él. */
export async function fetchAvailability(
  id: string,
  date: IsoDate,
  signal?: AbortSignal,
): Promise<Availability> {
  const useApi = resolveCatalogSource() === 'api' || useAuthStore.getState().status === 'authenticated';
  return useApi ? availabilityApi.getAvailability(id, date, signal) : demoAvailability(id, date);
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Disponibilidad determinista de demostración: franjas 09:00 y 14:00 como el seed del API. */
export function demoAvailability(id: string, date: IsoDate): Availability {
  const slots: AvailabilitySlot[] =
    date < today()
      ? []
      : ['09:00', '14:00'].map((time) => {
          const spots = hash(`${id}|${date}|${time}`) % 21;
          return { time, availableSpots: spots, status: spots > 0 ? 'AVAILABLE' : 'SOLD_OUT' };
        });
  return {
    date,
    timeZone: 'America/Guayaquil',
    availableSpots: slots.reduce((sum, s) => sum + s.availableSpots, 0),
    times: slots,
  };
}
