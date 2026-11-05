/** Nombres legibles de las acciones de la bitácora (ms-audit). Una acción nueva se muestra con su código. */
const LABELS: Record<string, string> = {
  ROL_ASIGNADO: 'Rol asignado',
  ROL_REVOCADO: 'Rol quitado',
  USUARIO_DESACTIVADO: 'Cuenta desactivada',
  USUARIO_REACTIVADO: 'Cuenta reactivada',
  ADMIN_INICIAL_CREADO: 'Primer administrador',
  CLIENTE_API_CREADO: 'Socio creado',
  CLIENTE_API_ACTIVADO: 'Socio activado',
  CLIENTE_API_DESACTIVADO: 'Socio desactivado',
  RESERVA_CREADA: 'Reserva creada',
  RESERVA_CONFIRMADA: 'Reserva confirmada',
  RESERVA_CANCELADA: 'Reserva cancelada',
  STOCK_ACTUALIZADO: 'Cupos actualizados',
  CupoBloqueado: 'Cupos reservados',
  CupoLiberado: 'Cupos liberados',
  OrdenCreada: 'Orden creada',
  OrdenPagada: 'Orden pagada',
  OrdenCancelada: 'Orden cancelada',
  RESENA_PUBLICADA: 'Reseña publicada',
};

export const auditLabel = (accion: string) => LABELS[accion] ?? accion;
