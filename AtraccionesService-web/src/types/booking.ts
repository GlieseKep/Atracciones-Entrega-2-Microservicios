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
}

export interface ReservationPage {
  total_results: number;
  items: Reservation[];
}
