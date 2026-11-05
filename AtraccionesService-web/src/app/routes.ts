/** Patrones de ruta de la aplicación (los constructores de URL están en `utils/routes.ts`). */
export const ROUTES = {
  home: '/',
  attractions: '/atracciones',
  attractionDetail: '/atracciones/:id',
  checkout: '/atracciones/:id/comprar',
  /** Ruta del portal anterior ("reservar sin pagar"): ahora lleva a la compra. */
  legacyReserve: '/atracciones/:id/reservar',
  search: '/buscar',
  reservation: '/reservas/:reservationId',
  profile: '/perfil',
  help: '/ayuda',
  login: '/login',
  register: '/registro',
  recover: '/recuperar',
  /** Enlaces de los correos de ms-identity (`?token=`). */
  resetPassword: '/recuperar-clave',
  verifyEmail: '/verificar-correo',
  admin: '/admin',
} as const;
