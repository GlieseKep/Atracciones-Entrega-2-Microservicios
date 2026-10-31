import { env } from '@/config/env';
import { currentAccessToken, useAuthStore } from '@/stores/authStore';
import type { ProblemDetails } from '@/types/api';
import { ApiError, classifyProblem } from '@/utils/api';

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Clave del intento lógico de mutación; ver `IdempotencyKeyManager`. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Cliente HTTP central (plan §9): URL base, cabeceras, Bearer token en memoria,
 * Idempotency-Key, deserialización y traducción de errores RFC 7807.
 */
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(env.apiBaseUrl + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const token = currentAccessToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('network', 0);
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    const kind = classifyProblem(response.status, problem, token !== null);
    if (kind === 'sessionExpired') useAuthStore.getState().clear({ expired: true });
    throw new ApiError(kind, response.status, problem);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function readProblem(response: Response): Promise<ProblemDetails> {
  try {
    const type = response.headers.get('Content-Type') ?? '';
    return type.includes('json') ? ((await response.json()) as ProblemDetails) : {};
  } catch {
    return {};
  }
}

export const http = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};
