import { errorFields, type EventBus, type Logger } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { EventRepository } from '../persistence/event-repository';

const BATCH = 100;

/** Envía al bus lo pendiente de `outbox_evento`, en orden. `OutboxRelay` no sirve: esta tabla tiene otra forma. */
export class EventPublisher {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventRepository,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly intervalMs = 500,
  ) {}

  private publishPending(): Promise<void> {
    return this.dataSource.transaction(async (m) => {
      for (const row of await this.events.pending(m, BATCH)) {
        await this.bus.publish(`booking.${row.evt_tipo}`, {
          specversion: '1.0',
          id: row.evt_uuid,
          source: row.evt_fuente,
          type: row.evt_tipo,
          subject: row.evt_aggregate_id,
          time: row.evt_creado_en.toISOString(),
          correlation_id: row.evt_correlation_id,
          data: row.evt_payload,
        });
        await this.events.markPublished(m, row.evt_id);
      }
    });
  }

  private tick(): void {
    if (this.running) return;
    this.running = this.publishPending()
      .catch((error: unknown) => this.logger.warn('no se pudieron publicar los eventos; se reintentará', errorFields(error)))
      .finally(() => {
        this.running = null;
      });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
