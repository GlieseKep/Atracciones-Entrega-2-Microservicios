import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ADMIN_SCOPE } from '@/api/admin';
import { endSession } from '@/features/auth/session';
import { hasScope, useAuthStore } from '@/stores/authStore';
import { paths } from '@/utils/routes';

export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const claims = useAuthStore((s) => s.claims);
  const user = useAuthStore((s) => s.user);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const location = useLocation();
  const navigate = useNavigate();

  const here = location.pathname + location.search;
  // Desde las propias páginas de acceso no se encadena otro returnTo.
  const target = (returnTo: string) => (/^\/(login|registro)/.test(returnTo) ? '/' : returnTo);
  const signIn = useCallback((returnTo = here) => navigate(paths.login(target(returnTo))), [navigate, here]);
  const signUp = useCallback((returnTo = here) => navigate(paths.register(target(returnTo))), [navigate, here]);
  const signOut = useCallback(() => {
    endSession();
    navigate(paths.home());
  }, [navigate]);

  return {
    status,
    isAuthenticated: status === 'authenticated',
    claims,
    user,
    sessionExpired,
    displayName: claims?.name ?? claims?.email ?? user?.email ?? 'Mi cuenta',
    canManageCatalog: hasScope(claims, ADMIN_SCOPE),
    hasScope: (scope: string) => hasScope(claims, scope),
    signIn,
    signUp,
    signOut,
  };
}
