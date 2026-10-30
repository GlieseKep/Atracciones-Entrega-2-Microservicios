import { AppError, errorFields, type EsbClient, type IdempotencyStore, type Logger, type Principal } from '@atracciones/platform';
import type { OrderRepository } from '../persistence/order-repository';
import { stepKey, storedProblem, type OrderResponse } from './purchase-saga';

export interface CancelOrderInput {
  idempotency_key: string;
  reservation_id: string;
  reason: string;
  solicitante: string;
}

interface Reservation extends Record<string, unknown> {
  reservation_code: string;
  external_order_id: string;
  status: string;
  guia_codigo: string;
}

const isTechnical = (error: unknown) => !(error instanceof AppError) || error.status >= 500;

/**
 * Saga de cancelación (plan §5.2): acción de compensación de Booking Prototipo (`RestaurarInventario`) o cancelación
 * voluntaria. Pasos LIFO: cancelar la reserva → liberar los cupos → reembolsar el 100 %. Es idempotente: una reserva ya
 * cancelada se devuelve con su estado actual (200), aunque llegue con otra Idempotency-Key.
 */
export class CancellationSaga {
  constructor(
    private readonly esb: EsbClient,
    private readonly orders: OrderRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly logger: Logger,
  ) {}

  async run(principal: Principal, input: CancelOrderInput): Promise<OrderResponse> {
    const { idempotency_key: key, ...payload } = input;
    const start = await this.idempotency.begin<OrderResponse>(principal, 'cancel-reservation', key, payload);
    if ('replay' in start) return start.replay.body;
    try {
      const response = await this.cancel(input);
      await this.idempotency.complete(start.recordId, { status: response.status, body: response });
      return response;
    } catch (error) {
      await this.idempotency.abandon(start.recordId).catch(() => undefined);
      if (isTechnical(error)) this.logger.error('cancelación interrumpida por una falla técnica', { reserva: input.reservation_id, ...errorFields(error) });
      throw error instanceof AppError ? error : AppError.internal();
    }
  }

  private async cancel(input: CancelOrderInput): Promise<OrderResponse> {
    const solicitante = input.solicitante || 'CLIENTE';
    const motivo = input.reason || `Cancelación solicitada por ${solicitante}`;
    let reserva: Reservation;
    try {
      // Valida dueño, estado y plazo antes de tocar nada.
      reserva = await this.esb.call<Reservation>('booking', 'cancelReservation', { id: input.reservation_id, solicitante, motivo, solo_validar: true });
    } catch (error) {
      if (isTechnical(error)) throw error;
      return storedProblem(error as AppError);
    }
    if (reserva.status === 'CANCELLED') return { status: 200, reserva, guia_asignado: await this.guideName(reserva.guia_codigo) };

    const order = await this.orders.findByExternalId(reserva.external_order_id);
    if (!order) throw AppError.internal(`La reserva ${reserva.reservation_code} no tiene orden asociada.`);
    const final = await this.compensate(order.id, order.codigo_externo, order.total, motivo, solicitante);
    return { status: 200, reserva: final, guia_asignado: await this.guideName(final.guia_codigo) };
  }

  /**
   * Cancela, libera y reembolsa. Cada paso es idempotente, así que el worker de recuperación puede repetirla completa si
   * se interrumpió. Al final la reserva queda con el código y el monto del reembolso.
   */
  async compensate(ordenId: string, codigoExterno: string, total: number, motivo: string, solicitante: string): Promise<Reservation> {
    await this.orders.setSaga(ordenId, 'COMPENSANDO');
    await this.esb.call('booking', 'cancelReservation', { id: codigoExterno, motivo, solicitante });
    await this.orders.recordStep(ordenId, 'EMITIR_RESERVA', 'COMPENSAR', 'OK');
    await this.esb.call('inventory', 'releaseSeats', { clave_idempotencia: stepKey(ordenId, 'inventory') });
    await this.orders.recordStep(ordenId, 'RESERVAR_CUPOS', 'COMPENSAR', 'OK');
    const refund = await this.esb.call<{ reembolso_codigo: string | null; monto: number }>('payment', 'refund', {
      clave_pago: stepKey(ordenId, 'payment'), monto: total, motivo, solicitante, clave_idempotencia: `${ordenId}:refund`,
    });
    await this.orders.recordStep(ordenId, 'REGISTRAR_PAGO', 'COMPENSAR', 'OK', refund.reembolso_codigo ? `Reembolso ${refund.reembolso_codigo}` : 'Sin cobro que reembolsar');
    const final = await this.esb.call<Reservation>('booking', 'cancelReservation', {
      id: codigoExterno, motivo, solicitante, reembolso_codigo: refund.reembolso_codigo ?? '', monto_reembolsado: refund.monto,
    });
    await this.orders.close(ordenId, 'CANCELADA', 'COMPENSADA');
    return final;
  }

  private async guideName(codigo: string): Promise<string> {
    if (!codigo) return 'Sin guía asignado (acceso libre)';
    try {
      return (await this.esb.call<{ nombre_visible: string }>('inventory', 'getGuide', { codigo })).nombre_visible;
    } catch {
      return codigo;
    }
  }
}
