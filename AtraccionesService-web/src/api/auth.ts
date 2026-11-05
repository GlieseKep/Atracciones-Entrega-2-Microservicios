import { authPost, startSession } from '@/features/auth/session';
import { useAuthStore } from '@/stores/authStore';
import type { ProfileUpdate, RegisterRequest, SessionResponse, User } from '@/types/identity';
import { gql } from './client';

/** Cuentas de ms-identity: la sesión va por REST (`/api/v3/auth`) y el perfil por GraphQL (`identity*`). */

export async function login(correo: string, password: string): Promise<User> {
  const session = await authPost<SessionResponse>('/auth/login', { correo: correo.trim().toLowerCase(), password });
  startSession(session);
  return session.usuario;
}

/** Crea la cuenta (rol `CLIENTE`) e inicia la sesión con las mismas credenciales. */
export async function register(body: RegisterRequest): Promise<User> {
  await authPost<User>('/auth/registro', body);
  return login(body.correo, body.password);
}

/** Siempre responde 202, exista o no la cuenta (no revela qué correos están registrados). */
export const requestPasswordRecovery = (correo: string) => authPost<void>('/auth/recuperacion', { correo: correo.trim().toLowerCase() });

export const confirmPasswordRecovery = (token: string, password: string) =>
  authPost<void>('/auth/recuperacion/confirmar', { token, password });

export const verifyEmail = (token: string) => authPost<void>('/auth/verificacion-correo', { token });

export async function resendVerification(): Promise<void> {
  await authPost<void>('/auth/verificacion-correo/reenvio', {}, useAuthStore.getState().accessToken ?? undefined);
}

export const getMe = (signal?: AbortSignal) => gql.query<User>('identityGetMe', {}, { signal });

export async function updateMe(patch: ProfileUpdate): Promise<User> {
  const user = await gql.mutation<User>('identityUpdateMe', patch);
  useAuthStore.getState().setUser(user);
  return user;
}

export const changePassword = (actual: string, nuevo: string) =>
  gql.mutation<void>('identityChangePassword', { password_actual: actual, password_nuevo: nuevo });
