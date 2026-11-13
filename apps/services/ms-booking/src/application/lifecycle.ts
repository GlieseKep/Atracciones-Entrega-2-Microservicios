import { AppError, errorFields, todayIn, type Logger } from '@atracciones/platform';
import type { IdempotencyRepository } from '../persistence/idempotency-repository';
import type { ReservationRepository, ReservationRow } from '../persistence/reservation-repository';
import { reservationEvent, stockEvent } from './purchase-flow';
import { seatKey, type Remote } from './remote';

const PENDING_MINUTES = 30;
const INTERVAL_MS = 5 * 60_000;

/** Estados finales que no dependen de ningún pedido: `EXPIRED` y `COMPLETED`. */
export class Lifecycle {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly reservations: ReservationRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly remote: Remote,
    private readonly logger: Logger,
  ) {}

  /** Una orden que Order ya pagó no se cancela: el evento del pago confirmará la reserva. */
  private async expirePending(row: ReservationRow): Promise<void> {
    try {
      await this.remote.cancelOrder(row.ord_numero, 'Reserva sin pagar');
    } catch (error) {
      if (error instanceof AppError && error.code === 'ORDER_ALREADY_PAID') return;
      throw error;
    }
    const seats = await this.remote.releaseSeats(seatKey(row.ord_numero));
    await this.reservations.transition(row.res_id, ['PENDING'], 'EXPIRED', {}, (updated) => [
      { tipo: 'RESERVA_CANCELADA', payload: reservationEvent(updated) },
      { tipo: 'STOCK_ACTUALIZADO', payload: stockEvent(updated, seats.cupos_disponibles) },
    ]);
  }

  /** `CONFIRMED` sin check-in cuya fecha ya pasó. */
  private async expireNoShows(): Promise<void> {
    const rows = await this.reservations.byState('CONFIRMED', 0);
    if (rows.length === 0) return;
    const today = todayIn();
    const slots = await this.remote.slots(rows.map((row) => Number(row.dis_id)));
    const past = new Set(slots.filter((slot) => slot.fecha < today).map((slot) => slot.dis_id));
    for (const row of rows) {
      if (past.has(Number(row.dis_id))) await this.reservations.transition(row.res_id, ['CONFIRMED'], 'EXPIRED', {}, () => []);
    }
  }

  /** `CHECKED_IN` cuyo turno ya pasó: el check-in puede ser anterior al día del turno, así que cuenta la fecha del turno. */
  private async completeCheckedIn(): Promise<void> {
    const rows = await this.reservations.byState('CHECKED_IN', 0);
    if (rows.length === 0) return;
    const today = todayIn();
    const slots = await this.remote.slots(rows.map((row) => Number(row.dis_id)));
    const past = new Set(slots.filter((slot) => slot.fecha < today).map((slot) => slot.dis_id));
    for (const row of rows) {
      if (past.has(Number(row.dis_id))) await this.reservations.transition(row.res_id, ['CHECKED_IN'], 'COMPLETED', {}, () => []);
    }
  }

  private async run(): Promise<void> {
    try {
      await this.idempotency.purgeExpired();
      for (const row of await this.reservations.byState('PENDING', PENDING_MINUTES)) await this.expirePending(row);
      await this.expireNoShows();
      await this.completeCheckedIn();
    } catch (error) {
      this.logger.error('no se pudieron actualizar los estados de las reservas', errorFields(error));
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
