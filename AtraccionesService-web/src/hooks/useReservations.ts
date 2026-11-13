import { useCallback, useRef, useState } from 'react';
import { cancelReservation, createReservation, listMyReservations } from '@/api/bookings';
import type { CreateReservationRequest, Reservation, ReservationPage, ReservationStatus } from '@/types/booking';
import { isApiError } from '@/utils/api';
import { mergeById } from '@/utils/diff';
import { IdempotencyKeyManager } from '@/utils/idempotency';
import { usePolling } from './usePolling';

/** Ejecuta una mutación conservando el Idempotency-Key mientras se reintenta el mismo payload. */
export function useIdempotentMutation<TPayload, TResult>(
  mutate: (payload: TPayload, idempotencyKey: string) => Promise<TResult>,
) {
  const manager = useRef(new IdempotencyKeyManager());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(
    async (payload: TPayload): Promise<TResult> => {
      setPending(true);
      setError(null);
      try {
        const result = await mutate(payload, manager.current.keyFor(payload));
        manager.current.complete();
        return result;
      } catch (err) {
        // Errores de red, 5xx o "en curso" pueden reintentarse con la misma clave; el resto es definitivo.
        if (!isApiError(err, 'network', 'server', 'rateLimit') && !(isApiError(err) && err.code === 'IDEMPOTENCY_IN_PROGRESS')) {
          manager.current.complete();
        }
        setError(err);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [mutate],
  );

  return { run, pending, error, clearError: () => setError(null) };
}

/** Compra completa en Booking: orden, cupos y pago en una sola operación idempotente. */
export function useCreateReservation() {
  return useIdempotentMutation<CreateReservationRequest, Reservation>(useCallback((body, key) => createReservation(body, key), []));
}

export function useCancelReservation(reservationId: string) {
  return useIdempotentMutation<string, Reservation>(
    useCallback((reason, key) => cancelReservation(reservationId, reason, key), [reservationId]),
  );
}

/** Mis Reservas se consulta en segundo plano cada 5 s (check-in presencial, cancelaciones). */
const RESERVATIONS_POLL_MS = 5000;

/**
 * Las reservas que cambiaron se reemplazan; las demás conservan su objeto. Las que ya no coinciden con el filtro
 * (p. ej. una confirmada que se canceló) se quedan visibles con su estado nuevo hasta la próxima carga normal.
 */
function mergeReservationPage(prev: ReservationPage, next: ReservationPage): ReservationPage {
  const items = mergeById(prev.items, next.items, (r) => r.reservation_id, { keepMissing: true });
  return items === prev.items && prev.total_results === next.total_results ? prev : { ...next, items };
}

export function useMyReservations(params: { estado?: ReservationStatus; page: number; limit: number }) {
  return usePolling((signal) => listMyReservations(params, signal), [JSON.stringify(params)], {
    intervalMs: RESERVATIONS_POLL_MS,
    merge: mergeReservationPage,
  });
}
