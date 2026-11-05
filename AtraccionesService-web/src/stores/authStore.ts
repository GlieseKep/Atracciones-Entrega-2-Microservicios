import { create } from 'zustand';
import type { RoleName, User } from '@/types/identity';

export type AuthStatus = 'anonymous' | 'authenticating' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  /** Solo en memoria: nunca se persisten en localStorage ni sessionStorage. Recargar la página cierra la sesión. */
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  /** Usuario de ms-identity; sus `roles` deciden qué ve la interfaz (el servidor sigue autorizando). */
  user: User | null;
  sessionExpired: boolean;
  setAuthenticating: () => void;
  setSession: (accessToken: string, refreshToken: string, expiresAt: number, user: User) => void;
  setUser: (user: User) => void;
  clear: (options?: { expired?: boolean }) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'anonymous',
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  user: null,
  sessionExpired: false,
  setAuthenticating: () => set({ status: 'authenticating' }),
  setSession: (accessToken, refreshToken, expiresAt, user) =>
    set({ status: 'authenticated', accessToken, refreshToken, expiresAt, user, sessionExpired: false }),
  setUser: (user) => set({ user }),
  clear: (options) =>
    set({
      status: 'anonymous',
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      user: null,
      sessionExpired: options?.expired ?? false,
    }),
}));

export const hasRole = (user: User | null, role: RoleName) => !!user?.roles.includes(role);
