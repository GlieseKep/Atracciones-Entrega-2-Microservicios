import { env } from '@/config/env';
import { accessToken, renewSession } from '@/features/auth/session';
import { useAuthStore } from '@/stores/authStore';
import type { GraphqlError, ProblemDetails } from '@/types/api';
import { ApiError, classifyError } from '@/utils/api';

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Clave del intento lógico de mutación; ver `IdempotencyKeyManager`. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Envía la petición con el token vigente. Un 401 con sesión renueva el token una vez y repite la petición; si sigue
 * fallando, la sesión se da por vencida.
 */
async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<{ response: Response; hadToken: boolean }> {
  const attempt = async (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    try {
      return await fetch(url, { ...init, headers, signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError('network', 0);
    }
  };
  const token = await accessToken();
  let response = await attempt(token);
  if (response.status === 401 && token) {
    const renewed = await renewSession();
    if (renewed) response = await attempt(renewed);
    else useAuthStore.getState().clear({ expired: true });
  }
  return { response, hadToken: token !== null };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Cliente REST del Gateway (`/api/v3`): sesión y contrato público de atracciones. Errores RFC 7807. */
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(env.apiBaseUrl + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const { response, hadToken } = await send(
    url.toString(),
    { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) },
    options.signal,
  );
  const data = await readJson(response);
  if (!response.ok) {
    const problem = (data ?? {}) as ProblemDetails;
    throw new ApiError(classifyError(response.status, problem.code, hadToken), response.status, {
      code: problem.code,
      detail: problem.detail,
      invalidParams: problem.invalid_params,
      correlationId: problem.correlation_id,
    });
  }
  return data as T;
}

export const http = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};

interface GraphqlOptions {
  /** Operaciones con `Idempotency-Key` (compra, cancelación): se envía como argumento `idempotencyKey`. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Llama a un campo del GraphQL del portal. Cada campo es una operación del ESB (`bookingCreateReservation`…) con su
 * entrada en `input` y la respuesta del servicio como JSON. GraphQL responde 200 con `errors[]`: el código del servicio
 * llega en `extensions.reason` y el estado HTTP equivalente en `extensions.status`.
 */
async function graphql<T>(kind: 'query' | 'mutation', field: string, input: object | undefined, options: GraphqlOptions = {}): Promise<T> {
  const idempotent = options.idempotencyKey !== undefined;
  const variables = `$input: JSON${idempotent ? ', $idempotencyKey: ID!' : ''}`;
  const args = `input: $input${idempotent ? ', idempotencyKey: $idempotencyKey' : ''}`;
  const query = `${kind} ${field[0].toUpperCase()}${field.slice(1)}(${variables}) { ${field}(${args}) }`;
  return execute<T>(query, { input: input ?? {}, ...(idempotent ? { idempotencyKey: options.idempotencyKey } : {}) }, field, options.signal);
}

/** Envía un documento GraphQL y devuelve `data[field]`, con los errores traducidos a `ApiError`. */
async function execute<T>(query: string, variables: Record<string, unknown>, field: string, signal?: AbortSignal): Promise<T> {
  const { response, hadToken } = await send(
    env.graphqlUrl,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    signal,
  );
  const body = (await readJson(response)) as { data?: Record<string, unknown> | null; errors?: GraphqlError[] } | ProblemDetails | undefined;

  // El Gateway responde en ProblemDetails si rechaza la petición antes de llegar a GraphQL (401, 429, 503).
  if (!body || !('data' in body || 'errors' in body)) {
    const problem = (body ?? {}) as ProblemDetails;
    const status = response.ok ? 500 : response.status;
    throw new ApiError(classifyError(status, problem.code, hadToken), status, { code: problem.code, detail: problem.detail, correlationId: problem.correlation_id });
  }
  const error = body.errors?.[0];
  if (error) {
    const ext = error.extensions ?? {};
    const status = typeof ext.status === 'number' ? ext.status : ext.code === 'UNAUTHENTICATED' ? 401 : 400;
    if (status === 401 && hadToken) useAuthStore.getState().clear({ expired: true });
    throw new ApiError(classifyError(status, ext.reason, hadToken), status, {
      code: ext.reason,
      detail: error.message,
      invalidParams: ext.invalidParams,
      correlationId: ext.correlationId,
    });
  }
  return (body.data?.[field] ?? null) as T;
}

export const gql = {
  query: <T>(field: string, input?: object, options?: GraphqlOptions) => graphql<T>('query', field, input, options),
  mutation: <T>(field: string, input?: object, options?: GraphqlOptions) => graphql<T>('mutation', field, input, options),
  /** Campos con tipo propio (no JSON), como `systemHealth`: el documento completo lo escribe quien llama. */
  document: <T>(query: string, field: string, signal?: AbortSignal) => execute<T>(query, {}, field, signal),
};
