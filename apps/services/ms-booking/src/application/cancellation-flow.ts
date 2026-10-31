import { AppError, hasRole, requirePrincipal, zonedToUtc, type Principal } from '@atracciones/platform';
import type { ReservaResponse, Solicitante } from '../contract';
import type { IdempotencyRepository, IdempotencySubject } from '../persistence/idempotency-repository';
import type { ReservationRepository, ReservationRow } from '../persistence/reservation-repository';
import { onceByKey } from './idempotency';
import { reservationEvent, stockEvent } from './purchase-flow';
import { seatKey, type Remote } from './remote';
import type { ReservationService } from './reservation-service';

const DEFAULT_REASON = 'Cancelación de la reserva';

/** Reembolso, cupos y estado, en ese orden. Cada paso es idempotente: un reintento no devuelve ni reintegra dos veces. */
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

  /** Solo el cliente tiene plazo: `SAGA_ORCHESTRATOR` y `ADMIN` pueden cancelar siempre. */
  private async assertDeadline(row: ReservationRow): Promise<void> {
    const slot = await this.remote.slot(Number(row.dis_id));
    const logistics = await this.remote.logisticsOrNull(slot.atraccion_id, null);
    if (!logistics) return;
    const limit = zonedToUtc(slot.fecha, slot.hora).getTime() - logistics.deadline_hours * 3_600_000;
    if (!logistics.free_cancellation || Date.now() > limit) {
      throw AppError.conflict('CANCELLATION_DEADLINE_PASSED', 'Pasó el plazo de cancelación gratuita de esta reserva.');
    }
  }

  private async cancel(id: string, reason: string, solicitante: Solicitante, principal: Principal): Promise<ReservaResponse> {
    const row = await this.service.require(id);
    await this.service.assertOwner(row, principal);
    this.assertRequester(solicitante, principal);
    if (row.est_codigo === 'CANCELLED') return this.service.present(row);
    if (row.est_codigo !== 'PENDING' && row.est_codigo !== 'CONFIRMED') throw AppError.conflict('RESERVATION_NOT_CANCELLABLE', `La reserva está ${row.est_codigo}.`);
    if (solicitante === 'CLIENTE') await this.assertDeadline(row);

    const { orden } = await this.remote.order({ ord_numero: row.ord_numero });
    const refund = await this.remote.refund(orden.ord_id, reason, row.res_uuid);
    if (!refund) await this.remote.cancelOrder(row.ord_numero, reason);
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
