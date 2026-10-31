import type {
  Attraction,
  CreateAttractionRequest,
  PaginatedAttractionResponse,
  SearchAttractionsRequest,
  SearchAttractionsResponse,
  UpdateAttractionRequest,
} from '@/types/attraction';
import { http } from './client';

/** Endpoints de catálogo (`/atracciones`). Todos exigen `attractions:read`; escrituras `attractions:write`. */

export const searchAttractions = (body: SearchAttractionsRequest, signal?: AbortSignal) =>
  http.post<SearchAttractionsResponse>('/atracciones/search', body, { signal });

export const listAttractions = (limit = 10, offset = 0, signal?: AbortSignal) =>
  http.get<PaginatedAttractionResponse>('/atracciones', { query: { limit, offset }, signal });

export const getAttraction = (id: string, signal?: AbortSignal) =>
  http.get<Attraction>(`/atracciones/${id}`, { signal });

export const createAttraction = (body: CreateAttractionRequest, idempotencyKey: string) =>
  http.post<Attraction>('/atracciones', body, { idempotencyKey });

export const replaceAttraction = (id: string, body: CreateAttractionRequest, idempotencyKey: string) =>
  http.put<void>(`/atracciones/${id}`, body, { idempotencyKey });

export const patchAttraction = (id: string, body: UpdateAttractionRequest, idempotencyKey: string) =>
  http.patch<Attraction>(`/atracciones/${id}`, body, { idempotencyKey });

export const deleteAttraction = (id: string, idempotencyKey: string) =>
  http.delete<void>(`/atracciones/${id}`, { idempotencyKey });
