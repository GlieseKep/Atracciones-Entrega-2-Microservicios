import { errorFields, type Logger } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { STOCK_EVENT, type StockPayload } from '../contract';
import type { BookingStockClient } from '../integration/booking-stock-client';

interface StockRow {
  id: string;
  event_id: string;
  agregado_id: string;
  correlation_id: string;
  intentos: number;
  /** Lleva más de `NOT_FOUND_LIMIT_MINUTES` esperando a que Booking conozca la atracción. */
  vencida: boolean;
  payload: StockPayload;
}

const BATCH = 200;
/** Booking conoce una atracción nueva cuando consulta nuestra tienda: mientras tanto se reintenta cada minuto, durante media hora. */
const NOT_FOUND_LIMIT_MINUTES = 30;

/**
 * Entrega a Booking Prototipo las filas `STOCK_BOOKING` del outbox, en orden. Si Booking no responde, quedan pendientes
 * y se reintentan: la venta no se revierte ni se frena el bus, que tiene su propio relay. Si no conoce la atracción, solo
 * esperan las filas de esa atracción. Las tramas llevan saldo absoluto y `timestamp`: Booking ignora las atrasadas.
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

  private logFields(row: StockRow, begin: number, resultado: string) {
    return {
      correlation_id: row.correlation_id,
      transporte: 'rest',
      destino: this.client.destination,
      item_id: row.payload.item_id,
      slot_id: row.payload.slot_id,
      date: row.payload.date,
      available_units: row.payload.available_units,
      resultado,
      duration_ms: Math.round(performance.now() - begin),
    };
  }

  private async mark(m: EntityManager, row: StockRow, detail: string | null): Promise<void> {
    await m.query(`UPDATE outbox SET publicado_en = now(), ultimo_error = $2 WHERE id = $1`, [row.id, detail]);
  }

  /** Aparta todas las filas pendientes de la atracción, para no llamar a Booking por cada turno. */
  private async postpone(m: EntityManager, row: StockRow, detail: string): Promise<void> {
    await m.query(
      `UPDATE outbox SET intentos = intentos + 1, ultimo_error = $3, proximo_en = now() + interval '1 minute'
       WHERE publicado_en IS NULL AND tipo_evento = $1 AND agregado_id = $2`,
      [STOCK_EVENT, row.agregado_id, detail.slice(0, 500)],
    );
  }

  private async fail(m: EntityManager, row: StockRow, error: unknown, begin: number): Promise<void> {
    await m.query(`UPDATE outbox SET intentos = intentos + 1, ultimo_error = $2 WHERE id = $1`, [row.id, String(error).slice(0, 500)]);
    this.logger.warn('STOCK_FALLIDO', { ...this.logFields(row, begin, 'retry'), intentos: row.intentos + 1, ...errorFields(error) });
  }

  /** Envía las filas en orden. `false` detiene la vuelta, para conservar el orden. */
  private async deliver(m: EntityManager, rows: StockRow[]): Promise<boolean> {
    const postponed = new Set<string>();
    for (const row of rows) {
      if (postponed.has(row.agregado_id)) continue;
      const begin = performance.now();
      try {
        const { result, detail } = await this.client.push(row.payload);
        if (result === 'retry') throw new Error(detail);
        if (result === 'not_found' && !row.vencida) {
          await this.postpone(m, row, detail);
          postponed.add(row.agregado_id);
          this.logger.warn('STOCK_FALLIDO', { ...this.logFields(row, begin, result), intentos: row.intentos + 1, error: detail });
          continue;
        }
        if (result === 'delivered') this.logger.info('STOCK_EMITIDO', this.logFields(row, begin, result));
        else this.logger.error('STOCK_FALLIDO', { ...this.logFields(row, begin, result), intentos: row.intentos + 1, error: detail });
        await this.mark(m, row, result === 'delivered' ? null : detail.slice(0, 500));
      } catch (error) {
        await this.fail(m, row, error, begin);
        return false;
      }
    }
    return true;
  }

  private async sendPending(): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const rows: StockRow[] = await m.query(
        `SELECT id, event_id, agregado_id, correlation_id, intentos, payload, creado_en < now() - make_interval(mins => $3) AS vencida
         FROM outbox
         WHERE publicado_en IS NULL AND tipo_evento = $1 AND (proximo_en IS NULL OR proximo_en <= now())
         ORDER BY creado_en, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [STOCK_EVENT, BATCH, NOT_FOUND_LIMIT_MINUTES],
      );
      await this.deliver(m, rows);
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
