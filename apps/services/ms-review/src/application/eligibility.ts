import { AppError, type EsbClient, type Principal } from '@atracciones/platform';

/** Lo que Review necesita de una reserva de Booking (`Reservation` de `internal/booking.proto`). */
export interface ReservationInfo {
  reservation_id: string;
  status: string;
  atraccion_codigo: string;
  principal_tipo: string;
  principal_id: string;
}

/** Consulta de reservas. `null` si no existe o el principal en curso no puede verla. */
export interface ReservationLookup {
  find(id: string): Promise<ReservationInfo | null>;
}

/** Estados en los que la reserva ya se usó y habilita una reseña. */
export const REVIEWABLE_STATUSES = ['CHECKED_IN', 'COMPLETED'];

/**
 * `booking.getReservation` por el ESB con el principal de la petición: Booking responde 403 si la reserva es de otro
 * cliente y 404 si no existe (los dos son "no encontrada" para Review). Sin respuesta → 503 `BOOKING_UNAVAILABLE`.
 */
export function esbReservationLookup(esb: EsbClient, timeoutMs = 2500): ReservationLookup {
  return {
    async find(id) {
      try {
        return await esb.call<ReservationInfo>('booking', 'getReservation', { id }, { timeoutMs });
      } catch (error) {
        const status = error instanceof AppError ? error.status : 0;
        if (status === 400 || status === 403 || status === 404) return null;
        throw new AppError(503, 'BOOKING_UNAVAILABLE', 'No se pudo verificar la reserva con Booking. Intente más tarde.');
      }
    },
  };
}

/**
 * Comprueba que la reserva habilita la reseña: es del usuario (no basta con poder verla: un administrador ve todas),
 * corresponde a la atracción y ya se usó. Devuelve el `reservation_id` (UUID) que se guarda.
 */
export async function checkEligibility(lookup: ReservationLookup, reservationId: string, attractionId: string, user: Principal): Promise<string> {
  const reservation = await lookup.find(reservationId);
  if (!reservation || reservation.principal_tipo !== user.tipo || reservation.principal_id !== user.id) {
    throw AppError.unprocessable('RESERVATION_NOT_FOUND', `No tiene una reserva ${reservationId}.`);
  }
  if (reservation.atraccion_codigo.toUpperCase() !== attractionId.toUpperCase()) {
    throw AppError.unprocessable('RESERVATION_NOT_ELIGIBLE', `La reserva ${reservationId} es de otra atracción.`);
  }
  if (!REVIEWABLE_STATUSES.includes(reservation.status)) {
    throw AppError.unprocessable('RESERVATION_NOT_ELIGIBLE', `La reserva ${reservationId} todavía no se ha usado (estado ${reservation.status}).`);
  }
  return reservation.reservation_id;
}
