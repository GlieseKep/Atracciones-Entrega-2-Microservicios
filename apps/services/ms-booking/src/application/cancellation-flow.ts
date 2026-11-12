import { AppError, hasRole, requirePrincipal, type Principal } from '@atracciones/platform';
import type { ReservaResponse, Solicitante } from '../contract';
import type { IdempotencyRepository, IdempotencySubject } from '../persistence/idempotency-repository';
import type { ReservationRepository, ReservationRow } from '../persistence/reservation-repository';
import { onceByKey } from './idempotency';
import { reservationEvent, stockEvent } from './purchase-flow';
import { seatKey, type Remote, type Refund } from './remote';
import type { ReservationService } from './reservation-service';

const DEFAULT_REASON = 'Cancelación de la reserva';

/**
 * Dos caminos, según el canal de la reserva:
 * - `WEB` (página web): la cancelan el cliente o un `ADMIN`, solo antes del check-in y sin reembolso. Se cancela la orden
 *   si sigue sin pagar (una pagada queda pagada) y los cupos vuelven al turno.
 * - `SOCIO` (Booking): solo la compensación de la saga (`SAGA_ORCHESTRATOR`) la cancela, como siempre: reembolso si hay
 *   pago aprobado (si no, se cancela la orden), cupos y estado.
 * Cada paso es idempotente: un reintento no devuelve ni reintegra dos veces.
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

  /** Las reservas de Booking solo las cancela su saga; las de la web, el cliente o un `ADMIN`. */
  private assertChannel(row: ReservationRow, solicitante: Solicitante): void {
    if (row.res_canal === 'SOCIO' && solicitante !== 'SAGA_ORCHESTRATOR') {
      throw AppError.conflict('RESERVATION_NOT_CANCELLABLE', 'Las reservas hechas desde Booking no se pueden cancelar desde la página web.');
    }
  }

  private assertBeforeCheckin(row: ReservationRow): void {
    if (row.est_codigo === 'PENDING' || row.est_codigo === 'CONFIRMED') return;
    if (row.est_codigo === 'CHECKED_IN' || row.est_codigo === 'COMPLETED') {
      throw AppError.conflict('RESERVATION_NOT_CANCELLABLE', 'La reserva ya tiene check-in y no se puede cancelar.');
    }
    throw AppError.conflict('RESERVATION_NOT_CANCELLABLE', `La reserva está ${row.est_codigo}.`);
  }

  /** Web: sin reembolso. Una orden ya pagada no se cancela; queda pagada y solo se liberan los cupos. */
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
    this.assertChannel(row, solicitante);
    this.assertBeforeCheckin(row);

    let refund: Refund | null = null;
    if (row.res_canal === 'SOCIO') refund = await this.refundOrCancelOrder(row, reason);
    else await this.cancelUnpaidOrder(row.ord_numero, reason);
    const seats = await this.remote.releaseSeats(seatKey(row.ord_numero));
    const updated = await this.reservations.transition(
      row.res_id,
      ['PENDING', 'CONFIRMED'],
      'CANCELLED',
      {
        res_motivo_cancelacion: reason.slice(0, 255),
        res_cancelado_por: solicitante,
        res_cancelado_en: new Date(),
        ...(refund ? { res_reembolso_id: refund.reembolso_id, res_monto_reembolsado: refund.monto_reembolsado } : {}),
      },
      (current) => [
        { tipo: 'RESERVA_CANCELADA', payload: reservationEvent(current) },
        { tipo: 'STOCK_ACTUALIZADO', payload: stockEvent(current, seats.cupos_disponibles) },
      ],
    );
    return this.service.present(updated ?? (await this.service.require(id)));
  }
}
