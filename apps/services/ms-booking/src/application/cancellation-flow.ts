import { AppError, hasRole, requirePrincipal, zonedToUtc, type Principal } from '@atracciones/platform';
import type { ReservaResponse, Solicitante } from '../contract';
import type { IdempotencyRepository, IdempotencySubject } from '../persistence/idempotency-repository';
import type { ReservationRepository, ReservationRow } from '../persistence/reservation-repository';
import { onceByKey } from './idempotency';
import { reservationEvent, stockEvent } from './purchase-flow';
import { seatKey, type Remote, type Refund } from './remote';
import { simulatedRefundId } from './reservation-mapper';
import type { ReservationService } from './reservation-service';

const DEFAULT_REASON = 'Cancelación de la reserva';
/** Plazo de la cancelación con reembolso del 100 %: hasta 24 horas antes del inicio del turno (fecha + hora, en Ecuador). */
const CANCELLATION_DEADLINE_HOURS = 24;

/** Reembolso simulado del 100 % del total, cuando no hubo un reembolso real por Refund. */
const simulatedRefund = (row: ReservationRow): Refund => ({ reembolso_id: simulatedRefundId(row), monto_reembolsado: Number(row.res_precio_total) });

/**
 * Cancela reservas `CONFIRMED` (sin check-in), sea de la web (`WEB`) o de Booking (`SOCIO`), con reembolso del 100 %. El
 * cliente y el `ADMIN` solo con al menos 24 horas de anticipación al turno; la compensación de la saga (`SAGA_ORCHESTRATOR`)
 * no tiene plazo. Una `PENDING` (pago sin confirmar) no se cancela: se resuelve con el evento del pago o con `Lifecycle`.
 * Reembolso, según el canal:
 * - `SOCIO`: reembolso real por Refund si hay pago aprobado; si no, se cancela la orden y el reembolso es simulado.
 * - `WEB`: reembolso simulado (`REF-ATR-<código>`); se cancela la orden si sigue sin pagar (una pagada queda pagada).
 * En los dos casos los cupos vuelven al turno. Cada paso es idempotente: un reintento no devuelve ni reintegra dos veces.
 */
export class CancellationFlow {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly service: ReservationService,
    private readonly remote: Remote,
    private readonly secret: string,
  ) {}

  async run(key: string, id: string, reason: string, solicitante: Solicitante): Promise<ReservaResponse> {
    const principal = await requirePrincipal(this.secret);
    const subject: IdempotencySubject = { tipo: principal.tipo === 'USUARIO' ? 'USUARIO' : 'CLIENTE_API', id: Number(principal.id) };
    return onceByKey(this.idempotency, key, subject, 'CancelReservation', { id, reason, solicitante }, () => this.cancel(id, reason || DEFAULT_REASON, solicitante, principal));
  }

  private assertRequester(solicitante: Solicitante, principal: Principal): void {
    if (solicitante === 'ADMIN' && !hasRole(principal, 'ADMIN')) throw AppError.forbidden('Solo un ADMIN puede cancelar como ADMIN.');
    if (solicitante === 'SAGA_ORCHESTRATOR' && principal.tipo !== 'API_CLIENTE') throw AppError.forbidden('Solo un socio puede cancelar por saga.');
  }

  /** Solo `CONFIRMED`: con check-in ya no se cancela y una `PENDING` todavía no tiene pago confirmado. */
  private assertBeforeCheckin(row: ReservationRow): void {
    if (row.est_codigo === 'CONFIRMED') return;
    if (row.est_codigo === 'CHECKED_IN' || row.est_codigo === 'COMPLETED') {
      throw AppError.conflict('RESERVATION_NOT_CANCELLABLE', 'No se puede cancelar una reserva que ya realizó check-in o fue asistida.');
    }
    if (row.est_codigo === 'PENDING') {
      throw AppError.conflict('RESERVATION_NOT_CANCELLABLE', 'La reserva aún no está confirmada (pago pendiente); no se puede cancelar.');
    }
    throw AppError.conflict('RESERVATION_NOT_CANCELLABLE', `La reserva está ${row.est_codigo}.`);
  }

  /** Cliente y `ADMIN`: al menos 24 horas antes del inicio del turno. La compensación de la saga de Booking no tiene plazo. */
  private async assertDeadline(row: ReservationRow, solicitante: Solicitante): Promise<void> {
    if (solicitante === 'SAGA_ORCHESTRATOR') return;
    const slot = await this.remote.slot(Number(row.dis_id));
    const start = zonedToUtc(slot.fecha, slot.hora.slice(0, 5));
    if (start.getTime() - Date.now() >= CANCELLATION_DEADLINE_HOURS * 3_600_000) return;
    throw AppError.conflict(
      'CANCELLATION_DEADLINE_PASSED',
      'La cancelación y reembolso solo están permitidos con al menos 24 horas de anticipación al horario reservado.',
    );
  }

  /** Web: una orden ya pagada no se cancela; queda pagada y el reembolso es simulado. */
  private async cancelUnpaidOrder(ordNumero: string, reason: string): Promise<void> {
    try {
      await this.remote.cancelOrder(ordNumero, reason);
    } catch (error) {
      if (error instanceof AppError && error.code === 'ORDER_ALREADY_PAID') return;
      throw error;
    }
  }

  /** Booking: como siempre, reembolso si hay pago aprobado; si no, se cancela la orden. */
  private async refundOrCancelOrder(row: ReservationRow, reason: string): Promise<Refund | null> {
    const { orden } = await this.remote.order({ ord_numero: row.ord_numero });
    const refund = await this.remote.refund(orden.ord_id, reason, row.res_uuid);
    if (!refund) await this.remote.cancelOrder(row.ord_numero, reason);
    return refund;
  }

  private async cancel(id: string, reason: string, solicitante: Solicitante, principal: Principal): Promise<ReservaResponse> {
    const row = await this.service.require(id);
    await this.service.assertOwner(row, principal);
    this.assertRequester(solicitante, principal);
    if (row.est_codigo === 'CANCELLED') return this.service.present(row);
    this.assertBeforeCheckin(row);
    await this.assertDeadline(row, solicitante);

    let refund: Refund | null = null;
    if (row.res_canal === 'SOCIO') refund = await this.refundOrCancelOrder(row, reason);
    else await this.cancelUnpaidOrder(row.ord_numero, reason);
    refund ??= simulatedRefund(row);
    const seats = await this.remote.releaseSeats(seatKey(row.ord_numero));
    const updated = await this.reservations.transition(
      row.res_id,
      ['CONFIRMED'],
      'CANCELLED',
      {
        res_motivo_cancelacion: reason.slice(0, 255),
        res_cancelado_por: solicitante,
        res_cancelado_en: new Date(),
        res_reembolso_id: refund.reembolso_id,
        res_monto_reembolsado: refund.monto_reembolsado,
      },
      (current) => [
        { tipo: 'RESERVA_CANCELADA', payload: reservationEvent(current) },
        { tipo: 'STOCK_ACTUALIZADO', payload: stockEvent(current, seats.cupos_disponibles) },
      ],
    );
    return this.service.present(updated ?? (await this.service.require(id)));
  }
}
