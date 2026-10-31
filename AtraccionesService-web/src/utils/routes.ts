/** Constructores de URL de la aplicación. Las rutas viven en `app/routes.ts`. */

export const paths = {
  home: () => '/',
  attractions: (query?: URLSearchParams | string) => {
    const qs = query ? query.toString() : '';
    return qs ? `/atracciones?${qs}` : '/atracciones';
  },
  attraction: (id: string) => `/atracciones/${id}`,
  reserve: (id: string, query?: URLSearchParams) => withQuery(`/atracciones/${id}/reservar`, query),
  purchase: (id: string, query?: URLSearchParams) => withQuery(`/atracciones/${id}/comprar`, query),
  reservation: (id: string) => `/reservas/${id}`,
  order: (id: string) => `/pedidos/${id}`,
  profile: (tab?: string) => (tab ? `/perfil?tab=${tab}` : '/perfil'),
  admin: () => '/admin',
  login: (returnTo?: string) => withQuery('/login', returnTo && returnTo !== '/' ? new URLSearchParams({ returnTo }) : undefined),
  register: (returnTo?: string) => withQuery('/registro', returnTo && returnTo !== '/' ? new URLSearchParams({ returnTo }) : undefined),
};

function withQuery(path: string, query?: URLSearchParams) {
  const qs = query?.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Solo permite volver a rutas internas (evita redirecciones abiertas tras iniciar sesión). */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
