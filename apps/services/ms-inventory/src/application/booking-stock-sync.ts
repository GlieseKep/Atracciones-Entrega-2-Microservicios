import { errorFields, type Logger } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { STOCK_EVENT, type StockPayload } from '../contract';
import type { BookingStockClient } from '../integration/booking-stock-client';

interface StockRow {
  id: string;
  event_id: string;
  payload: StockPayload;
}

const BATCH = 200;

/**
 * Entrega a Booking Prototipo las filas `STOCK_BOOKING` del outbox, en orden. Si Booking no responde, quedan pendientes
 * y se reintentan: la venta no se revierte ni se frena el bus, que tiene su propio relay.
 */
export class BookingStockSync {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly client: BookingStockClient,
    private readonly logger: Logger,
    private readonly intervalMs = 2000,
  ) {}

  private async mark(m: EntityManager, rows: StockRow[], detail: string | null): Promise<void> {
    await m.query(`UPDATE outbox SET publicado_en = now(), ultimo_error = $2 WHERE id = ANY($1::uuid[])`, [rows.map((row) => row.id), detail]);
  }

  private async fail(m: EntityManager, row: StockRow, error: unknown): Promise<void> {
    await m.query(`UPDATE outbox SET intentos = intentos + 1, ultimo_error = $2 WHERE id = $1`, [row.id, String(error).slice(0, 500)]);
    this.logger.warn('Booking no recibió el stock; se reintentará', { event_id: row.event_id, ...errorFields(error) });
  }

  /** Envía un bloque de filas seguidas del mismo modo. `false` detiene la vuelta, para conservar el orden. */
  private async deliver(m: EntityManager, group: StockRow[]): Promise<boolean> {
    if (group[0].payload.modo === 'stream') {
      try {
        await this.client.stream(group.map((row) => ({ eventId: row.event_id, stock: row.payload })));
        await this.mark(m, group, null);
        return true;
      } catch (error) {
        await this.fail(m, group[0], error);
        return false;
      }
    }
    for (const row of group) {
      try {
        const { result, detail } = await this.client.push(row.payload);
        if (result === 'retry') throw new Error(detail);
        if (result === 'rejected') this.logger.error('Booking rechazó el stock', { event_id: row.event_id, detail });
        await this.mark(m, [row], result === 'rejected' ? detail.slice(0, 500) : null);
      } catch (error) {
        await this.fail(m, row, error);
        return false;
      }
    }
    return true;
  }

  private async sendPending(): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const rows: StockRow[] = await m.query(
        `SELECT id, event_id, payload FROM outbox WHERE publicado_en IS NULL AND tipo_evento = $1 ORDER BY creado_en, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [STOCK_EVENT, BATCH],
      );
      let index = 0;
      while (index < rows.length) {
        const modo = rows[index].payload.modo;
        const start = index;
        while (index < rows.length && rows[index].payload.modo === modo) index++;
        if (!(await this.deliver(m, rows.slice(start, index)))) return;
      }
    });
  }

  private tick(): void {
    if (this.running) return;
    this.running = this.sendPending()
      .catch((error: unknown) => this.logger.error('falló la entrega de stock', errorFields(error)))
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
