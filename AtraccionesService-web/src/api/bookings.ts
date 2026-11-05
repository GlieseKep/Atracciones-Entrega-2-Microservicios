import type { CheckinRequest, CheckinResult, CreateReservationRequest, Reservation, ReservationPage, ReservationStatus } from '@/types/booking';
import { gql } from './client';

/**
 * Compra y reservas de ms-booking por GraphQL. Booking orquesta en una sola llamada la orden (Order), los cupos
 * (Inventory) y el cobro (Payment); el dueño de la reserva es el usuario de la sesión.
 */

export const createReservation = (body: CreateReservationRequest, idempotencyKey: string) =>
  gql.mutation<Reservation>('bookingCreateReservation', body, { idempotencyKey });

export const getReservation = (id: string, signal?: AbortSignal) => gql.query<Reservation>('bookingGetReservation', { id }, { signal });

export const listMyReservations = (params: { estado?: ReservationStatus; page?: number; limit?: number }, signal?: AbortSignal) =>
  gql.query<ReservationPage>('bookingListReservations', params, { signal });

export const cancelReservation = (id: string, reason: string, idempotencyKey: string) =>
  gql.mutation<Reservation>('bookingCancelReservation', { id, reason, solicitante: 'CLIENTE' }, { idempotencyKey });

/** Check-in presencial (guía, operador o ADMIN). Booking avisa a Booking Central si la compra vino de un socio. */
export const checkIn = (body: CheckinRequest, idempotencyKey: string) => gql.mutation<CheckinResult>('bookingCheckIn', body, { idempotencyKey });
