import { useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import type { IsoDate } from '@/types/api';
import {
  fetchAttraction,
  fetchAvailability,
  fetchCatalog,
  resolveCatalogSource,
} from '@/features/attractions/catalogService';
import { applyFilters, DEFAULT_FILTERS, facets, type CatalogFilters } from '@/features/attractions/filters';
import { useAsync } from './useAsync';

/** Listado filtrado y paginado. Solo vuelve a pedir datos cuando cambian los filtros que viajan al API. */
export function useAttractions(filters: CatalogFilters) {
  const status = useAuthStore((s) => s.status);
  const serverKey = `${filters.city}|${filters.date}|${filters.minRating}|${filters.sort}|${status}`;
  const catalog = useAsync((signal) => fetchCatalog(filters, signal), [serverKey]);

  const page = useMemo(() => (catalog.data ? applyFilters(catalog.data, filters) : null), [catalog.data, filters]);
  const options = useMemo(() => facets(catalog.data ?? []), [catalog.data]);

  return { ...catalog, page, facets: options, source: resolveCatalogSource() };
}

/** Todas las atracciones (secciones del Home y relacionadas). */
export function useAllAttractions() {
  const status = useAuthStore((s) => s.status);
  return useAsync((signal) => fetchCatalog(DEFAULT_FILTERS, signal), [status]);
}

export function useAttraction(id: string | undefined) {
  const status = useAuthStore((s) => s.status);
  return useAsync((signal) => fetchAttraction(id!, signal), [id, status], !!id);
}

export function useAvailability(id: string | undefined, date: IsoDate | '') {
  const status = useAuthStore((s) => s.status);
  return useAsync((signal) => fetchAvailability(id!, date as IsoDate, signal), [id, date, status], !!id && !!date);
}
