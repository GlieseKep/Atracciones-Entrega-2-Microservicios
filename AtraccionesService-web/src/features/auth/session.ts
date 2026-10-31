import { env } from '@/config/env';
import { useAuthStore, type SessionClaims } from '@/stores/authStore';

/**
 * Sesión con el servicio de autenticación de TourGirls (dev-auth): correo y contraseña a cambio de un JWT.
 * El token vive solo en memoria (nunca en localStorage ni sessionStorage); recargar la página cierra la sesión.
 */

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  user: { id: string; email: string; name: string };
}

/** Error del servicio de autenticación con mensaje apto para la interfaz y errores por campo. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function call(path: string, body: unknown): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${env.authUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('No pudimos conectar con el servicio de inicio de sesión. Inténtalo de nuevo.', 'NETWORK');
  }
  const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
    detail?: string;
    code?: string;
    errors?: Record<string, string[]>;
  };
  if (!response.ok || !data.access_token) {
    throw new AuthError(data.detail ?? 'No se pudo iniciar sesión.', data.code ?? 'ERROR', data.errors);
  }
  return data as TokenResponse;
}

export const loginWithPassword = (email: string, password: string) => call('/auth/login', { email, password });

export const registerAccount = (name: string, email: string, password: string) => call('/auth/register', { name, email, password });

/** Guarda la sesión en memoria a partir de la respuesta del servicio. */
export function startSession(response: TokenResponse): void {
  const expiresAt = Date.now() + Math.max(0, response.expires_in - 30) * 1000;
  useAuthStore.getState().setSession(response.access_token, expiresAt, claimsFrom(response.access_token));
}

export function endSession(): void {
  useAuthStore.getState().clear();
}

/** Decodifica el payload de un JWT sin validarlo: solo para mostrar claims; el API valida la firma. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function claimsFrom(accessToken: string): SessionClaims {
  const claims = decodeJwtPayload(accessToken) ?? {};
  const scopes = [claims.scope, claims.scp]
    .flatMap((v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(' ') : []))
    .filter((s): s is string => typeof s === 'string' && s !== '');
  return {
    sub: String(claims.sub ?? ''),
    email: typeof claims.email === 'string' ? claims.email : undefined,
    name: typeof claims.name === 'string' ? claims.name : undefined,
    scopes,
    roles: [],
  };
}
