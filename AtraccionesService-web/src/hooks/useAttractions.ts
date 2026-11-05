import { useMemo } from 'react';
import { getAttraction, getAvailability, listCategories, listCities, listLanguages, searchAttractions } from '@/api/catalog';
import { toSearchRequest, type CatalogFilters } from '@/features/attractions/filters';
import type { IsoDate } from '@/types/api';
import type { SearchRequest } from '@/types/attraction';
import { useAsync } from './useAsync';

/** Listado filtrado y paginado por el servidor (`POST /atracciones/search`). */
export function useAttractions(filters: CatalogFilters) {
  const body = useMemo(() => toSearchRequest(filters), [filters]);
  return useAsync((signal) => searchAttractions(body, signal), [JSON.stringify(body)]);
}

/** Búsqueda libre para secciones del inicio y relacionadas. */
export function useSearch(body: SearchRequest, enabled = true) {
  return useAsync((signal) => searchAttractions(body, signal), [JSON.stringify(body)], enabled);
}

export function useAttraction(id: string | undefined) {
  return useAsync((signal) => getAttraction(id!, signal), [id], !!id);
}

export function useAvailability(id: string | undefined, date: IsoDate | '') {
  return useAsync((signal) => getAvailability(id!, date as IsoDate, signal), [id, date], !!id && !!date);
}

/** Lecturas que cambian poco y usan varias partes de la página a la vez: una sola petición por carga del portal. */
function shared<T>(load: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load().catch((error: unknown) => {
    pending = null;
    throw error;
  }));
}

const categoriesOnce = shared(() => listCategories());
const citiesOnce = shared(() => listCities());
const languagesOnce = shared(() => listLanguages());

/** Categorías raíz de ms-catalog. */
export const useCategories = () => useAsync(() => categoriesOnce(), []);

/** Ciudades activas de ms-location. */
export const useCities = () => useAsync(() => citiesOnce(), []);

/** Categorías, ciudades e idiomas: facetas del buscador. Si alguna falla, ese filtro simplemente no se muestra. */
export function useCatalogFacets() {
  const categories = useCategories();
  const cities = useCities();
  const languages = useAsync(() => languagesOnce(), []);
  return { categories: categories.data ?? [], cities: cities.data ?? [], languages: languages.data ?? [] };
}
