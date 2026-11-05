import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { ButtonLink } from '@/components/common/Button';
import { useAuth } from '@/hooks/useAuth';
import type { RoleName } from '@/types/identity';
import { paths } from '@/utils/routes';

/**
 * Rutas privadas: sin sesión se envía al inicio de sesión conservando la ruta de regreso. Con `role`, además exige ese
 * rol de ms-identity (`usuario.roles`); el servidor sigue siendo quien autoriza.
 */
export function ProtectedRoute({ children, role }: { children: ReactNode; role?: RoleName }) {
  const { isAuthenticated, hasRole } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to={paths.login(location.pathname + location.search)} replace />;
  }

  if (role && !hasRole(role)) {
    return (
      <div className="page-container flex min-h-[50vh] flex-col items-center justify-center text-center">
        <ShieldAlert size={40} className="text-danger" aria-hidden="true" />
        <h1 className="mt-4 text-2xl">No tienes permiso para ver esta sección</h1>
        <p className="mt-2 max-w-md text-ink-soft">Tu cuenta no tiene el rol necesario.</p>
        <ButtonLink to="/" className="mt-5">
          Volver al inicio
        </ButtonLink>
      </div>
    );
  }

  return <>{children}</>;
}
