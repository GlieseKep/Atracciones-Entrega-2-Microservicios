import type { DataSource } from 'typeorm';
import { createLogger, errorFields, type Logger } from '../logging';
import type { EventBus, EventEnvelope } from '../messaging';

/**
 * Relay del patrón Transactional Outbox (plan §6.3): publica en el bus los eventos pendientes de la tabla `outbox` del
 * servicio, en orden, y los marca como publicados. `FOR UPDATE SKIP LOCKED` permite varias instancias sin duplicar.
 * Si la publicación falla, el evento queda pendiente con su error y se reintenta en la siguiente vuelta.
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly bus: EventBus,
    private readonly service: string,
    private readonly options: {
      schema?: string;
      intervalMs?: number;
      batch?: number;
      logger?: Logger;
      /** Tipos que no van al bus porque los entrega otro proceso del servicio. */
      excludeTypes?: string[];
    } = {},
  ) {}

  private get table() {
    return this.options.schema ? `${this.options.schema}.outbox` : 'outbox';
  }

  /** Publica un lote de eventos pendientes; devuelve cuántos publicó. */
  async publishPending(): Promise<number> {
    if (this.running) return this.running;
    this.running = this.dataSource.transaction(async (m) => {
      const rows: { id: string; event_id: string; tipo_evento: string; agregado_id: string; payload: Record<string, unknown>; correlation_id: string; creado_en: Date }[] = await m.query(
        `SELECT id, event_id, tipo_evento, agregado_id, payload, correlation_id, creado_en FROM ${this.table}
          WHERE publicado_en IS NULL AND NOT (tipo_evento = ANY($2::varchar[])) ORDER BY creado_en, id LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [this.options.batch ?? 100, this.options.excludeTypes ?? []],
      );
      let published = 0;
      for (const row of rows) {
        const event: EventEnvelope = {
          specversion: '1.0', id: row.event_id, source: `/servicios/${this.service}`, type: row.tipo_evento, subject: row.agregado_id,
          time: new Date(row.creado_en).toISOString(), correlation_id: row.correlation_id, data: row.payload,
        };
        try {
          await this.bus.publish(`${this.service}.${row.tipo_evento}`, event);
          await m.query(`UPDATE ${this.table} SET publicado_en = now() WHERE id = $1`, [row.id]);
          published++;
        } catch (error) {
          await m.query(`UPDATE ${this.table} SET intentos = intentos + 1, ultimo_error = $2 WHERE id = $1`, [row.id, String(error).slice(0, 500)]);
          (this.options.logger ?? createLogger(this.service)).warn('no se pudo publicar un evento del outbox', { event_id: row.event_id, ...errorFields(error) });
          break; // se conserva el orden: los siguientes esperan a la próxima vuelta
        }
      }
      return published;
    }).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.publishPending().catch(() => undefined), this.options.intervalMs ?? 500);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
