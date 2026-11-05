import { env } from '@/config/env';
import { useAuthStore } from '@/stores/authStore';
import type { ProblemDetails } from '@/types/api';
import type { SessionResponse } from '@/types/identity';
import { ApiError, classifyError } from '@/utils/api';

/**
 * Sesión con ms-identity a través del Gateway (`/api/v3/auth/*`): el JWT de acceso y el refresh token viven solo en
 * memoria. Cuando el acceso está por vencer se renueva con `POST /auth/refresh` sin pedir otra vez la contraseña.
 */

/** Margen antes del vencimiento para renovar el token de acceso. */
const RENEW_BEFORE_MS = 30_000;

/** `POST {apiBaseUrl}{path}` sin sesión. Es la base de login, registro, renovación y recuperación. */
export async function authPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const problem = (data ?? {}) as ProblemDetails;
    throw new ApiError(classifyError(response.status, problem.code), response.status, {
      code: problem.code,
      detail: problem.detail,
      invalidParams: problem.invalid_params,
      correlationId: problem.correlation_id,
    });
  }
  return data as T;
}

/** Guarda la sesión en memoria a partir de la respuesta de Identity. */
export function startSession(response: SessionResponse): void {
  const expiresAt = Date.now() + Math.max(0, response.expires_in) * 1000;
  useAuthStore.getState().setSession(response.access_token, response.refresh_token, expiresAt, response.usuario);
}

let renewing: Promise<string | null> | null = null;

/** Renueva el token de acceso con el refresh token (una sola renovación a la vez). Sin éxito, cierra la sesión. */
export function renewSession(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return Promise.resolve(null);
  renewing ??= authPost<SessionResponse>('/auth/refresh', { refresh_token: refreshToken })
    .then((response) => {
      startSession(response);
      return response.access_token;
    })
    .catch(() => {
      useAuthStore.getState().clear({ expired: true });
      return null;
    })
    .finally(() => {
      renewing = null;
    });
  return renewing;
}

/** Token vigente para una petición: lo renueva si está por vencer; `null` sin sesión. */
export async function accessToken(): Promise<string | null> {
  const { accessToken: token, expiresAt } = useAuthStore.getState();
  if (!token) return null;
  if (expiresAt !== null && Date.now() >= expiresAt - RENEW_BEFORE_MS) return renewSession();
  return token;
}

/** Cierra la sesión en Identity (revoca el refresh token) y la borra de memoria aunque el servidor no responda. */
export async function endSession(): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  useAuthStore.getState().clear();
  if (token) await authPost<void>('/auth/logout', {}, token).catch(() => undefined);
}
