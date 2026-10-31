/** Patrones de ruta de la aplicación (los constructores de URL están en `utils/routes.ts`). */
export const ROUTES = {
  home: '/',
  attractions: '/atracciones',
  attractionDetail: '/atracciones/:id',
  reserve: '/atracciones/:id/reservar',
  purchase: '/atracciones/:id/comprar',
  search: '/buscar',
  reservation: '/reservas/:reservationId',
  order: '/pedidos/:orderId',
  profile: '/perfil',
  help: '/ayuda',
  login: '/login',
  register: '/registro',
  admin: '/admin',
} as const;
