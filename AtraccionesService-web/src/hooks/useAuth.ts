import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { endSession } from '@/features/auth/session';
import { hasRole, useAuthStore } from '@/stores/authStore';
import type { RoleName } from '@/types/identity';
import { paths } from '@/utils/routes';

export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const location = useLocation();
  const navigate = useNavigate();

  const here = location.pathname + location.search;
  // Desde las propias páginas de acceso no se encadena otro returnTo.
  const target = (returnTo: string) => (/^\/(login|registro|recuperar|verificar-correo)/.test(returnTo) ? '/' : returnTo);
  const signIn = useCallback((returnTo = here) => navigate(paths.login(target(returnTo))), [navigate, here]);
  const signUp = useCallback((returnTo = here) => navigate(paths.register(target(returnTo))), [navigate, here]);
  const signOut = useCallback(() => {
    void endSession();
    navigate(paths.home());
  }, [navigate]);

  return {
    status,
    isAuthenticated: status === 'authenticated',
    user,
    sessionExpired,
    displayName: user ? `${user.nombre} ${user.apellido}`.trim() : 'Mi cuenta',
    /** Roles de ms-identity (`usuario.roles`); la interfaz solo los usa para mostrar u ocultar accesos. */
    isAdmin: hasRole(user, 'ADMIN'),
    hasRole: (role: RoleName) => hasRole(user, role),
    signIn,
    signUp,
    signOut,
  };
}
