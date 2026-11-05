/** Tipos del contrato `Plan/ms_booking/booking.proto`, con los nombres del contrato v3. */
export type ReservationState = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export const EVENT_TYPES = ['RESERVA_CREADA', 'RESERVA_CONFIRMADA', 'STOCK_ACTUALIZADO', 'RESERVA_CANCELADA'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type Solicitante = 'CLIENTE' | 'SAGA_ORCHESTRATOR' | 'ADMIN';

/** Estado del aviso del check-in a Booking Central (extensión del contrato). */
export type NotificacionBooking = 'NO_APLICA' | 'PENDIENTE' | 'ENVIADA' | 'FALLIDA';

export interface CustomerInput {
  nombre: string;
  correo: string;
  telefono: string;
  tipoDocumento: 'CEDULA' | 'PASAPORTE' | 'RUC';
  documento: string;
}

export interface CardData {
  marca: string;
  ultimos4: string;
  titular: string;
  mes: number;
  anio: number;
  pais: string;
}

/** `CreateReservationRequest` validado. */
export interface PurchaseInput {
  idempotencyKey: string;
  attractionId: string;
  slotId: string;
  date: string;
  adultos: number;
  ninos: number;
  seniors: number;
  infantes: number;
  requerimientos: string | null;
  customer: CustomerInput;
  metodo: string;
  sagaId: string | null;
  cartItemId: number | null;
  couponCode: string | null;
  tarjeta: CardData | null;
}

export interface ReservaResponse {
  external_order_id: string;
  reservation_id: string;
  reservation_code: string;
  status: ReservationState;
  date: string;
  time: string;
  ticket_count: number;
  adult_count: number;
  child_count: number;
  senior_count: number;
  student_count: number;
  infant_count: number;
  cantidad_adultos: number;
  cantidad_ninos: number;
  cantidad_seniors: number;
  cantidad_estudiantes: number;
  cantidad_infantes: number;
  total_price: number;
  currency: string;
  fecha: string;
  hora: string;
  precio_total: number;
  moneda: string;
  estado: ReservationState;
  customer: Record<string, string>;
  guia_asignado: string;
  punto_encuentro: string;
  voucher_qr_payload: string;
  reembolso_id: string;
  monto_reembolsado: number;
  _links: { self: string; checkin: string; cancel: string };
  /** Extensiones: turista de `cliente_api` (vacío en compras web) y aviso del check-in a Booking Central. */
  client_id: string;
  notificacion_booking: NotificacionBooking;
  /** Extensión: código público de la atracción (`atr_codigo`) y su nombre, para enlazar la reserva con su ficha. */
  attraction_id: string;
  attraction_name: string;
}

export interface CheckinResponse {
  reserva_id: string;
  reservation_code: string;
  estado: ReservationState;
  titular_nombre: string;
  titular_documento: string;
  guia_asignado: string;
  punto_encuentro: string;
  hora_checkin: string;
  pase_abordar_qr: string;
  notificacion_booking: NotificacionBooking;
}
