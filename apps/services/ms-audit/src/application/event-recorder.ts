import type { EventEnvelope, EventHandler, Logger } from '@atracciones/platform';
import type { AuditRecord } from '../contract';
import type { AuditRepository } from '../persistence/audit-repository';

/** Propia de este servicio: `audit` es la cola del servicio viejo, y compartirla repartiría los eventos entre ambos. */
export const EVENT_QUEUE = 'ms-audit';
export const EVENT_PATTERNS = ['#'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const optional = (value: unknown, length: number) => (typeof value === 'string' && value ? value.slice(0, length) : null);

function userId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** La fila del evento, o `null` si le falta lo que exige la tabla. Sin lista de tipos: un evento nuevo también se guarda. */
export function toRecord(event: EventEnvelope): AuditRecord | null {
  const accion = optional(event.type, 60);
  // `source` es `/servicios/<servicio>`.
  const entidad = optional(typeof event.source === 'string' ? event.source.split('/').pop() : null, 60);
  if (typeof event.id !== 'string' || !UUID.test(event.id) || !accion || !entidad) return null;
  const creadoEn = new Date(event.time);
  return {
    eventId: event.id,
    usuId: userId(event.data?.usu_id),
    accion,
    entidad,
    entidadId: optional(event.subject, 64),
    correlationId: optional(event.correlation_id, 64),
    detalle: event.data ?? null,
    creadoEn: Number.isNaN(creadoEn.getTime()) ? new Date() : creadoEn,
  };
}

/** Un error de la base se propaga para que el bus reintente. Un evento mal formado se descarta para no bloquear la cola. */
export function eventRecorder(audit: AuditRepository, logger: Logger): EventHandler {
  return async (event) => {
    const record = toRecord(event);
    if (record) await audit.record(record);
    else logger.warn('evento mal formado: no se guarda en la bitácora', { event_id: event.id, type: event.type, source: event.source });
  };
}
