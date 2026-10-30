/**
 * Valores cerrados del contrato `atracciones-openapi-v2.yaml` que se repiten en varias bases de datos.
 * Deben coincidir exactamente con los `enum` del YAML.
 */

/** `PassengerItem.ticket_type`; también es la fila de cada tipo en `*_boleto` y `*_precio`. */
export const TIPOS_BOLETO = ['ADULT', 'CHILD', 'SENIOR', 'STUDENT', 'INFANT'] as const;
export type TipoBoleto = (typeof TIPOS_BOLETO)[number];
/** Tipos que `TarifaBaseDesglosada` exige (`student` es opcional). */
export const TIPOS_BOLETO_OBLIGATORIOS_EN_TARIFA = ['ADULT', 'CHILD', 'SENIOR', 'INFANT'] as const;

/** `CustomerContactDto.document_type`. */
export const TIPOS_DOCUMENTO = ['CEDULA', 'PASAPORTE', 'RUC'] as const;

/** `CreateReservaRequestV2.payment_method`. */
export const METODOS_PAGO = ['TARJETA_CREDITO', 'TRANSFERENCIA', 'SOA_BOOKING_GATEWAY', 'PAGO_EN_SITIO'] as const;

/** `ReservaConfirmadaResponseV2.status`. */
export const ESTADOS_RESERVA = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const;

/** `CancelReservationRequest.solicitante`. */
export const SOLICITANTES_CANCELACION = ['CLIENTE', 'SAGA_ORCHESTRATOR', 'ADMIN'] as const;

/** `OutboxEventItem.event_type`. */
export const TIPOS_EVENTO_PUBLICO = ['RESERVA_CREADA', 'RESERVA_CONFIRMADA', 'STOCK_ACTUALIZADO', 'RESERVA_CANCELADA'] as const;

/** Scopes de los tokens y de las claves de API (plan, sección 3.1). */
export const SCOPES = [
  'attractions:read',
  'attractions:book',
  'attractions:cancel',
  'attractions:checkin',
  'attractions:write',
  'promotions:read',
  'promotions:write',
  'events:read',
] as const;

/** Dueño de una operación: un usuario del JWT o un cliente de `X-API-Key`. */
export const TIPOS_PRINCIPAL = ['USUARIO', 'API_CLIENTE'] as const;
