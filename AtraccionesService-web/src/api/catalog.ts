import type { IsoDate } from '@/types/api';
import type { AttractionDetail, Availability, Category, SearchRequest, SearchResponse } from '@/types/attraction';
import type { City } from '@/types/location';
import { gql, http } from './client';

/** Catálogo público del contrato v3 (`/api/v3/atracciones`, sin credenciales) y ciudades de ms-location. */

export const searchAttractions = (body: SearchRequest, signal?: AbortSignal) =>
  http.post<SearchResponse>('/atracciones/search', body, { signal });

/** `id` es el código público (`3GdwkIAEDKjp`) o el slug. */
export const getAttraction = (id: string, signal?: AbortSignal) =>
  http.get<AttractionDetail>(`/atracciones/${encodeURIComponent(id)}`, { signal });

/** Turnos del día con cupos en tiempo real (nunca desde caché). */
export const getAvailability = (id: string, date: IsoDate, signal?: AbortSignal) =>
  http.get<Availability>(`/atracciones/${encodeURIComponent(id)}/disponibilidad`, { query: { date }, signal });

export const listCategories = (signal?: AbortSignal) => http.get<Category[]>('/atracciones/categorias', { signal });

/** Idiomas de guía (`codigo`, `nombre`); la búsqueda acepta cualquiera de los dos en `idioma_guia`. */
export const listLanguages = (signal?: AbortSignal) => gql.query<{ codigo: string; nombre: string }[]>('catalogListLanguages', {}, { signal });

export const listCities = (signal?: AbortSignal) => gql.query<City[]>('locationListCities', {}, { signal });
