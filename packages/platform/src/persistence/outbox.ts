import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { currentCorrelationId, newCorrelationId } from '../correlation';

export interface OutboxEvent {
  tipoEvento: string;
  agregadoId: string;
  payload: Record<string, unknown>;
}

/**
 * Registra un evento en la tabla `outbox` del servicio, dentro de la misma transacción que el cambio de estado
 * (patrón Transactional Outbox, plan §6.3). Lo publica después el relay del servicio. Devuelve el `event_id`.
 * `schema` es el esquema donde vive la tabla (Inventory usa `schema_atracciones`).
 */
export async function recordEvent(manager: EntityManager, event: OutboxEvent, schema?: string): Promise<string> {
  const eventId = randomUUID();
  await manager.query(
    `INSERT INTO ${schema ? `${schema}.outbox` : 'outbox'} (event_id, tipo_evento, agregado_id, payload, correlation_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [eventId, event.tipoEvento, event.agregadoId, JSON.stringify(event.payload), currentCorrelationId() ?? newCorrelationId()],
  );
  return eventId;
}

/** Igual que `recordEvent`, pero varios eventos en una sola consulta (la base puede estar en otra región). */
export async function recordEvents(manager: EntityManager, events: OutboxEvent[], schema?: string): Promise<string[]> {
  if (events.length === 0) return [];
  const ids = events.map(() => randomUUID());
  await manager.query(
    `INSERT INTO ${schema ? `${schema}.outbox` : 'outbox'} (event_id, tipo_evento, agregado_id, payload, correlation_id)
     SELECT unnest($1::uuid[]), unnest($2::varchar[]), unnest($3::varchar[]), unnest($4::jsonb[]), $5`,
    [ids, events.map((e) => e.tipoEvento), events.map((e) => e.agregadoId), events.map((e) => JSON.stringify(e.payload)), currentCorrelationId() ?? newCorrelationId()],
  );
  return ids;
}
