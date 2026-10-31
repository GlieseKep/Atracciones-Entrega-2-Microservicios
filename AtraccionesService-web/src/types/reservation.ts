import type { IsoDate, Price } from './api';

/** Tipos de reservas (AtraccionesService.Contracts/Reservations). */

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface ReservationRequest {
  date: IsoDate;
  time: string;
  ticketCount: number;
  customerName: string;
  customerEmail: string;
}

export interface Reservation {
  reservationId: string;
  attractionId: string;
  status: ReservationStatus;
  date: IsoDate;
  time: string;
  ticketCount: number;
  totalPrice: Price;
}

export interface ReservationListParams {
  limit?: number;
  offset?: number;
  status?: ReservationStatus;
  fromDate?: IsoDate;
  toDate?: IsoDate;
  sort?: 'date' | '-date';
}
