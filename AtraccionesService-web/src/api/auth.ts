import { loginWithPassword, registerAccount, startSession, type TokenResponse } from '@/features/auth/session';
import { useAuthStore } from '@/stores/authStore';
import type { RegisterProfileRequest, RegisterProfileResponse, User } from '@/types/identity';
import { isApiError } from '@/utils/api';
import { http } from './client';

/** Registro del perfil local en el API: la identidad sale de los claims del token, no del cuerpo. */
export const registerProfile = (body: RegisterProfileRequest = {}) =>
  http.post<RegisterProfileResponse>('/auth/register', body);

export const getMe = (signal?: AbortSignal) => http.get<User>('/users/me', { signal });

/** Devuelve el usuario local; si el perfil aún no existe lo registra (primer inicio de sesión). */
export async function ensureProfile(): Promise<User> {
  try {
    return await getMe();
  } catch (error) {
    if (!isApiError(error, 'notFound') && !(isApiError(error) && error.code === 'PROFILE_NOT_REGISTERED')) throw error;
    await registerProfile();
    return getMe();
  }
}

/** Inicia la sesión y aprovisiona el perfil del API. Un fallo del perfil no invalida la sesión: se reintentará. */
async function establish(response: TokenResponse): Promise<void> {
  startSession(response);
  try {
    useAuthStore.getState().setUser(await ensureProfile());
  } catch {
    /* el perfil se reintentará al usarlo */
  }
}

export async function login(email: string, password: string): Promise<void> {
  await establish(await loginWithPassword(email.trim(), password));
}

export async function register(name: string, email: string, password: string): Promise<void> {
  await establish(await registerAccount(name.trim(), email.trim(), password));
}
