import type { IsoDate } from './api';

/** Compra y reservas de ms-booking (contrato v3: `CreateReservaRequestV3` y `ReservaConfirmadaResponseV2`). */

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export type DocumentType = 'CEDULA' | 'PASAPORTE' | 'RUC';

export type PaymentMethodCode = 'CREDIT_CARD' | 'DEBIT_CARD' | 'PAYPAL' | 'TRANSFER';

export type TicketType = 'adult' | 'child' | 'senior' | 'infant';

export type TicketCounts = Record<TicketType, number>;

export interface Customer {
  full_name: string;
  email: string;
  phone: string;
  document_type: DocumentType;
  document_id: string;
}

/** Datos no sensibles de la tarjeta: Payment solo recibe la marca y los últimos 4 dígitos. */
export interface CardData {
  marca: string;
  ultimos4: string;
  titular: string;
  mes: number;
  anio: number;
  pais: string;
}

export interface CreateReservationRequest {
  attraction_id: string;
  slot_id: string;
  date: IsoDate;
  time: string;
  adult_count: number;
  child_count: number;
  senior_count: number;
  infant_count: number;
  special_requirements?: string;
  customer: Customer;
  payment_method: { method: PaymentMethodCode };
  tarjeta?: CardData;
  coupon_code?: string;
}

export interface Reservation {
  /** Número de la orden en ms-order (`ord_numero`). */
  external_order_id: string;
  reservation_id: string;
  reservation_code: string;
  status: ReservationStatus;
  date: IsoDate;
  time: string;
  ticket_count: number;
  adult_count: number;
  child_count: number;
  senior_count: number;
  student_count: number;
  infant_count: number;
  total_price: number;
  currency: string;
  customer: Customer;
  guia_asignado: string;
  punto_encuentro: string;
  voucher_qr_payload: string;
  reembolso_id?: string;
  monto_reembolsado?: number;
  /** Código público de la atracción (`3GdwkIAEDKjp`) y su nombre: enlazan la reserva con su ficha. */
  attraction_id?: string;
  attraction_name?: string;
  /** Turista de `cliente_api` (solo compras de Booking). */
  client_id?: string;
  notificacion_booking?: BookingNotificationStatus;
  /** `WEB` (página web) o `SOCIO` (Booking). Las dos se cancelan antes del check-in. */
  canal?: 'WEB' | 'SOCIO';
  /** Solo en reservas `CANCELLED`: comprobante, reembolso del 100 % y cupos devueltos al turno. */
  cancel_code?: string;
  refund?: CancellationRefund;
  stock_restoration?: StockRestoration;
  message?: string;
}

export interface CancellationRefund {
  refund_id: string;
  status: 'PROCESSED';
  amount: number;
  currency: string;
  message: string;
}

export interface StockRestoration {
  status: 'RESTORED';
  restored_spots: number;
  message: string;
}

/** Aviso del check-in a Booking Central. */
export type BookingNotificationStatus = 'NO_APLICA' | 'PENDIENTE' | 'ENVIADA' | 'FALLIDA';

/** `POST /atracciones/reservas/{id}/checkin` (contrato v3) y sus opcionales para Booking Central. */
export interface CheckinRequest {
  id: string;
  documento_identidad: string;
  codigo_voucher_qr?: string;
  guia_codigo?: string;
  scanner_device_id?: string;
  asistentes_reales?: number;
  observaciones?: string;
}

export interface CheckinResult {
  reserva_id: string;
  reservation_code: string;
  estado: ReservationStatus;
  titular_nombre: string;
  titular_documento: string;
  guia_asignado: string;
  punto_encuentro: string;
  hora_checkin: string;
  pase_abordar_qr: string;
  notificacion_booking: BookingNotificationStatus;
}

export interface ReservationPage {
  total_results: number;
  items: Reservation[];
}
