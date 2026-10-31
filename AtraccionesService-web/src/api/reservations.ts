import type { Reservation, ReservationRequest } from '@/types/reservation';
import { http } from './client';

export const createReservation = (attractionId: string, body: ReservationRequest, idempotencyKey: string) =>
  http.post<Reservation>(`/atracciones/${attractionId}/reservations`, body, { idempotencyKey });

export const cancelReservation = (reservationId: string, reason: string, idempotencyKey: string) =>
  http.post<Reservation>(`/atracciones/reservations/${reservationId}/cancel`, { reason }, { idempotencyKey });

export const getReservation = (reservationId: string, signal?: AbortSignal) =>
  http.get<Reservation>(`/atracciones/reservations/${reservationId}`, { signal });
