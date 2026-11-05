import { returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';

/** Se deja de reintentar a los 15 intentos (queda `FALLIDA`). */
export const MAX_NOTIFICATION_ATTEMPTS = 15;

/** Mientras se envía, el aviso queda reservado este tiempo: otro proceso no lo toma a la vez. */
const LEASE = `interval '2 minutes'`;

/** Cuerpo de `POST /api/v3/reservas/{external_order_id}/checkin` de Booking Central. */
export interface CheckinNotificationPayload {
  external_order_id: string;
  client_id: string;
  estado: 'CONFIRMADO_ASISTIDO';
  asistentes_reales: number;
  admin_id: string;
  fecha_checkin: string;
  observaciones: string;
}

export interface PendingNotification {
  res_id: string;
  nch_payload: CheckinNotificationPayload;
  nch_intentos: number;
}

/** Avisos del check-in a Booking Central (`notificacion_checkin`), con reintentos. */
export class CheckinNotificationRepository {
  constructor(private readonly db: DataSource) {}

  /** Dentro de la transacción del check-in. */
  async insert(m: EntityManager, resId: string, payload: CheckinNotificationPayload): Promise<void> {
    await m.query(`INSERT INTO notificacion_checkin (res_id, nch_payload) VALUES ($1, $2::jsonb) ON CONFLICT (res_id) DO NOTHING`, [resId, JSON.stringify(payload)]);
  }

  /** Toma avisos vencidos y sin enviar (todos, o solo el de `resId`) y los reserva unos minutos. */
  async claim(limit: number, resId: string | null = null): Promise<PendingNotification[]> {
    return returnedRows<PendingNotification>(await this.db.query(
      `UPDATE notificacion_checkin SET nch_proximo_en = now() + ${LEASE}
        WHERE res_id IN (
          SELECT res_id FROM notificacion_checkin
           WHERE nch_enviado_en IS NULL AND nch_intentos < $1 AND nch_proximo_en <= now() AND ($3::bigint IS NULL OR res_id = $3)
           ORDER BY nch_proximo_en
           LIMIT $2
           FOR UPDATE SKIP LOCKED)
        RETURNING res_id, nch_payload, nch_intentos`,
      [MAX_NOTIFICATION_ATTEMPTS, limit, resId],
    ));
  }

  async markSent(resId: string): Promise<void> {
    await this.db.query(`UPDATE notificacion_checkin SET nch_enviado_en = now(), nch_ultimo_error = NULL WHERE res_id = $1`, [resId]);
  }

  /** Espera 1, 2, 4… minutos, hasta 60, antes del siguiente intento. */
  async markFailed(resId: string, error: string): Promise<number> {
    const rows = returnedRows<{ nch_intentos: number }>(await this.db.query(
      `UPDATE notificacion_checkin
          SET nch_intentos = nch_intentos + 1,
              nch_ultimo_error = left($2, 500),
              nch_proximo_en = now() + make_interval(mins => least(60, power(2, nch_intentos)::int))
        WHERE res_id = $1
        RETURNING nch_intentos`,
      [resId, error],
    ));
    return rows[0]?.nch_intentos ?? 0;
  }
}
