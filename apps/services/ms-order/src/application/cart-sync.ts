import { AppError, errorFields, type EsbClient, type Logger } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { CART_SYNC_EVENT, type CartSyncPayload } from '../contract';

interface SyncRow {
  id: string;
  event_id: string;
  payload: CartSyncPayload;
}

const BATCH = 50;

/**
 * Entrega a Cart las filas `CART_SYNC` del outbox. Se escriben en la misma transacción que el cambio de la orden, así que
 * un pago aprobado nunca se pierde ni se revierte si Cart no responde: se reintenta.
 */
export class CartSync {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly esb: EsbClient,
    private readonly logger: Logger,
    private readonly intervalMs = 2000,
  ) {}

  private async deliver(row: SyncRow, m: EntityManager): Promise<boolean> {
    const { accion, cai_id: itemId, ord_numero: numero } = row.payload;
    try {
      await this.esb.call('cart', accion === 'confirmar' ? 'confirmItem' : 'releaseItem', { itemId, external_order_id: numero });
      await m.query(`UPDATE outbox SET publicado_en = now() WHERE id = $1`, [row.id]);
      return true;
    } catch (error) {
      // Un 4xx no se arregla reintentando: por ejemplo, el ítem ya cambió de estado.
      if (error instanceof AppError && error.status < 500) {
        this.logger.error('Cart rechazó el aviso de la orden', { event_id: row.event_id, ord_numero: numero, code: error.code });
        await m.query(`UPDATE outbox SET publicado_en = now(), ultimo_error = $2 WHERE id = $1`, [row.id, error.code]);
        return true;
      }
      await m.query(`UPDATE outbox SET intentos = intentos + 1, ultimo_error = $2 WHERE id = $1`, [row.id, String(error).slice(0, 500)]);
      this.logger.warn('Cart no respondió; se reintentará', { event_id: row.event_id, ...errorFields(error) });
      return false;
    }
  }

  private sendPending(): Promise<void> {
    return this.dataSource.transaction(async (m) => {
      const rows: SyncRow[] = await m.query(
        `SELECT id, event_id, payload FROM outbox WHERE publicado_en IS NULL AND tipo_evento = $1 ORDER BY creado_en, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [CART_SYNC_EVENT, BATCH],
      );
      for (const row of rows) {
        if (!(await this.deliver(row, m))) return;
      }
    });
  }

  private tick(): void {
    if (this.running) return;
    this.running = this.sendPending()
      .catch((error: unknown) => this.logger.error('falló el aviso a Cart', errorFields(error)))
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
