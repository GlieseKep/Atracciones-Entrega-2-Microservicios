import { currentCorrelationId, newCorrelationId } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { EventType } from '../contract';

export interface EventRow {
  evt_id: string;
  evt_uuid: string;
  evt_specversion: string;
  evt_fuente: string;
  evt_tipo: EventType;
  evt_aggregate_id: string;
  evt_correlation_id: string;
  evt_payload: Record<string, unknown>;
  evt_creado_en: Date;
}

const COLUMNS = `evt_id, evt_uuid, evt_specversion, evt_fuente, evt_tipo, evt_aggregate_id, evt_correlation_id, evt_payload, evt_creado_en`;

export class EventRepository {
  constructor(private readonly db: DataSource) {}

  /** Se escribe en la transacción de la reserva. */
  async record(m: EntityManager, tipo: EventType, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    const correlationId = (currentCorrelationId() ?? newCorrelationId()).slice(0, 64);
    await m.query(`INSERT INTO outbox_evento (evt_tipo, evt_aggregate_id, evt_correlation_id, evt_payload) VALUES ($1, $2, $3, $4)`, [tipo, aggregateId, correlationId, JSON.stringify(payload)]);
  }

  list(after: number, limit: number, type: string | null): Promise<EventRow[]> {
    return this.db.query(
      `SELECT ${COLUMNS} FROM outbox_evento WHERE evt_id > $1 AND ($2::varchar IS NULL OR evt_tipo = $2) ORDER BY evt_id LIMIT $3`,
      [after, type, limit],
    );
  }

  /** Lote pendiente, bloqueado para que varias instancias no lo publiquen dos veces. */
  pending(m: EntityManager, batch: number): Promise<EventRow[]> {
    return m.query(`SELECT ${COLUMNS} FROM outbox_evento WHERE evt_publicado_en IS NULL ORDER BY evt_id LIMIT $1 FOR UPDATE SKIP LOCKED`, [batch]);
  }

  async markPublished(m: EntityManager, evtId: string): Promise<void> {
    await m.query(`UPDATE outbox_evento SET evt_publicado_en = now() WHERE evt_id = $1`, [evtId]);
  }
}
