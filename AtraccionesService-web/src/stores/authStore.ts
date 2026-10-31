import { create } from 'zustand';
import type { User } from '@/types/identity';

/** Claims no sensibles que la interfaz necesita para mostrar sesión y permisos. */
export interface SessionClaims {
  sub: string;
  email?: string;
  name?: string;
  scopes: string[];
  roles: string[];
}

export type AuthStatus = 'anonymous' | 'authenticating' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  /** Solo en memoria: nunca se persiste en localStorage ni sessionStorage (plan §10). */
  accessToken: string | null;
  expiresAt: number | null;
  claims: SessionClaims | null;
  user: User | null;
  sessionExpired: boolean;
  setAuthenticating: () => void;
  setSession: (token: string, expiresAt: number, claims: SessionClaims) => void;
  setUser: (user: User | null) => void;
  clear: (options?: { expired?: boolean }) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'anonymous',
  accessToken: null,
  expiresAt: null,
  claims: null,
  user: null,
  sessionExpired: false,
  setAuthenticating: () => set({ status: 'authenticating' }),
  setSession: (accessToken, expiresAt, claims) => set({ status: 'authenticated', accessToken, expiresAt, claims, sessionExpired: false }),
  setUser: (user) => set({ user }),
  clear: (options) =>
    set({
      status: 'anonymous',
      accessToken: null,
      expiresAt: null,
      claims: null,
      user: null,
      sessionExpired: options?.expired ?? false,
    }),
}));

/** Token vigente o `null` si no hay sesión o expiró. */
export function currentAccessToken(): string | null {
  const { accessToken, expiresAt } = useAuthStore.getState();
  if (!accessToken) return null;
  if (expiresAt !== null && Date.now() >= expiresAt) {
    useAuthStore.getState().clear({ expired: true });
    return null;
  }
  return accessToken;
}

export const hasScope = (claims: SessionClaims | null, scope: string) => !!claims?.scopes.includes(scope);
