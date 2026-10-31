import type { EventEnvelope, EventHandler, Logger } from '@atracciones/platform';
import type { OrderRepository } from '../persistence/order-repository';

export const EVENT_QUEUE = 'ms-order';
export const EVENT_PATTERNS = ['payment.PagoAprobado', 'payment.PagoRechazado', 'refund.ReembolsoEmitido'];

/** Todos son idempotentes: un evento repetido no cambia una orden que ya pasó de estado. */
export function paymentEventHandler(orders: OrderRepository, logger: Logger): EventHandler {
  async function onApproved(event: EventEnvelope, ordId: number) {
    if (await orders.markPaid(ordId)) return;
    const row = await orders.findById(ordId);
    if (row?.est_codigo === 'CANCELADA') logger.error('pago aprobado de una orden cancelada: hay que devolverlo con Refund', { event_id: event.id, ord_id: ordId });
  }

  return async (event) => {
    const ordId = Number(event.data.ord_id);
    if (!Number.isSafeInteger(ordId) || ordId < 1) {
      logger.warn('evento descartado: sin ord_id', { event_id: event.id, type: event.type });
      return;
    }
    if (event.type === 'PagoAprobado') await onApproved(event, ordId);
    else if (event.type === 'PagoRechazado') await orders.cancel(ordId);
    else if (event.type === 'ReembolsoEmitido') await orders.markRefunded(ordId, Number(event.data.monto_acumulado));
  };
}
