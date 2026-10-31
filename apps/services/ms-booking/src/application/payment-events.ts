import type { EventEnvelope, EventHandler, Logger } from '@atracciones/platform';
import type { ReservationRepository, ReservationRow } from '../persistence/reservation-repository';
import { reservationEvent, stockEvent } from './purchase-flow';
import { seatKey, type Remote } from './remote';

export const EVENT_QUEUE = 'ms-booking';
export const EVENT_PATTERNS = ['payment.PagoAprobado', 'payment.PagoRechazado', 'refund.ReembolsoEmitido'];

/** Idempotentes por el estado de la reserva. Los eventos traen `ord_id`, y la reserva guarda `ord_numero`. */
export function paymentEventHandler(reservations: ReservationRepository, remote: Remote, logger: Logger): EventHandler {
  async function onApproved(row: ReservationRow) {
    await reservations.transition(row.res_id, ['PENDING'], 'CONFIRMED', { res_confirmado_en: new Date() }, (updated) => [
      { tipo: 'RESERVA_CONFIRMADA', payload: reservationEvent(updated) },
    ]);
  }

  /** `ReleaseSeats` no cambia nada si se repite. */
  async function onRejected(row: ReservationRow, event: EventEnvelope) {
    if (row.est_codigo !== 'PENDING') return;
    const seats = await remote.releaseSeats(seatKey(row.ord_numero));
    const motivo = typeof event.data.motivo === 'string' ? event.data.motivo.slice(0, 255) : 'Pago rechazado';
    await reservations.transition(
      row.res_id,
      ['PENDING'],
      'CANCELLED',
      { res_motivo_cancelacion: motivo, res_cancelado_por: 'SAGA_ORCHESTRATOR', res_cancelado_en: new Date() },
      (updated) => [
        { tipo: 'RESERVA_CANCELADA', payload: reservationEvent(updated) },
        { tipo: 'STOCK_ACTUALIZADO', payload: stockEvent(updated, seats.cupos_disponibles) },
      ],
    );
  }

  return async (event) => {
    const ordId = Number(event.data.ord_id);
    if (!Number.isSafeInteger(ordId) || ordId < 1) {
      logger.warn('evento descartado: sin ord_id', { event_id: event.id, type: event.type });
      return;
    }
    const { orden } = await remote.order({ ord_id: ordId });
    const row = await reservations.findByOrder(orden.ord_numero);
    if (!row) {
      logger.warn('evento de una orden sin reserva', { event_id: event.id, type: event.type, ord_numero: orden.ord_numero });
      return;
    }
    if (event.type === 'PagoAprobado') await onApproved(row);
    else if (event.type === 'PagoRechazado') await onRejected(row, event);
    else if (event.type === 'ReembolsoEmitido') await reservations.recordRefund(orden.ord_numero, String(event.data.reembolso_id), Number(event.data.monto_acumulado));
  };
}
