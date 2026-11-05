import { AppError, errorFields, newCorrelationId, runWithContext, type Logger } from '@atracciones/platform';
import { MAX_NOTIFICATION_ATTEMPTS, type CheckinNotificationRepository, type PendingNotification } from '../persistence/checkin-notification-repository';
import type { Remote } from './remote';

const BATCH = 50;

/**
 * Avisa a Booking Central cada check-in de una reserva de socio (`POST /api/v3/reservas/{external_order_id}/checkin`).
 * El check-in ya quedó confirmado aquí: si Booking no responde, el aviso se reintenta en segundo plano con espera
 * creciente, hasta `MAX_NOTIFICATION_ATTEMPTS`.
 */
export class CheckinNotifier {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly notifications: CheckinNotificationRepository,
    private readonly remote: Remote,
    private readonly logger: Logger,
    private readonly intervalMs: number,
  ) {}

  /** Primer intento, justo después del check-in. Nunca lanza: un fallo solo deja el aviso pendiente. */
  async send(resId: string): Promise<void> {
    try {
      for (const notification of await this.notifications.claim(1, resId)) await this.deliver(notification);
    } catch (error) {
      this.logger.error('no se pudo enviar el aviso del check-in a Booking', { res_id: resId, ...errorFields(error) });
    }
  }

  private async run(): Promise<void> {
    try {
      for (const notification of await this.notifications.claim(BATCH)) await this.deliver(notification);
    } catch (error) {
      this.logger.error('no se pudieron reintentar los avisos del check-in a Booking', errorFields(error));
    }
  }

  /** Cada intento, también los reintentos, lleva el `X-Correlation-Id` del check-in que lo originó. */
  private deliver(notification: PendingNotification): Promise<void> {
    return runWithContext({ correlationId: notification.nch_correlation_id ?? newCorrelationId() }, () => this.attempt(notification));
  }

  private async attempt(notification: PendingNotification): Promise<void> {
    const external = notification.nch_payload.external_order_id;
    const intento = notification.nch_intentos + 1;
    try {
      await this.remote.notifyCheckin(notification.nch_payload);
      await this.notifications.markSent(notification.res_id);
      this.logger.info('CHECKIN_AVISO_ENVIADO', { external_order_id: external, intentos: intento });
    } catch (error) {
      const status = error instanceof AppError ? error.status : null;
      // Booking ya tenía registrado el check-in: el aviso cumplió su objetivo.
      if (status === 409) {
        await this.notifications.markSent(notification.res_id);
        this.logger.info('CHECKIN_AVISO_ENVIADO', { external_order_id: external, http_status: status, intentos: intento });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const intentos = await this.notifications.markFailed(notification.res_id, message);
      const fields = { external_order_id: external, http_status: status, intentos, agotado: intentos >= MAX_NOTIFICATION_ATTEMPTS, ...errorFields(error) };
      if (fields.agotado) this.logger.error('CHECKIN_AVISO_FALLIDO', fields);
      else this.logger.warn('CHECKIN_AVISO_FALLIDO', fields);
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.run(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
