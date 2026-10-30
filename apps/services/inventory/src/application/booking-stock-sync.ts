import {
  callUnary,
  createLogger,
  errorFields,
  grpc,
  loadProto,
  serviceConstructor,
  timeLabel,
  type Logger,
} from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { S } from '../persistence/inventory-repository';

export interface BookingSyncConfig {
  /** `host:puerto` de `inventory.InventoryStockService` de Booking (`localhost:50051`; `booking.epn.edu.ec:50051` en producción). */
  address: string;
  tls: boolean;
  /** `service_id` acordado con Booking (contrato §2.2; ejemplo `atracciones-dilan`). */
  serviceId: string;
  intervalMs: number;
}

interface PendingRow {
  id: string;
  event_id: string;
  metodo: 'PUSH' | 'STREAM';
  cupos_disponibles: number | null;
  delta: number | null;
  generado_en: Date;
  atraccion_codigo: string;
  fecha: string;
  hora: string;
}

/** Espera antes de reintentar un envío fallido: 2^intentos segundos, hasta 5 minutos. */
const BACKOFF = `(s.procesado_en IS NULL OR s.estado = 'PENDIENTE' OR s.procesado_en + make_interval(secs => least(300, power(2, s.intentos))) < now())`;

/**
 * Envía a Booking Prototipo cada cambio de cupos registrado en `sincronizacion_booking` (contrato §2.2): `PushStockUpdate`
 * por cada venta, cancelación o recarga, y `StreamInventoryChanges` para las cargas masivas (turnos nuevos). Si Booking
 * no responde, la venta no se bloquea: el envío queda en ERROR y se reintenta con espera exponencial.
 */
export class BookingStockSync {
  private readonly client: grpc.Client;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: BookingSyncConfig,
    private readonly logger: Logger = createLogger('inventory'),
  ) {
    const service = serviceConstructor(loadProto('booking/inventory.proto'), 'inventory.InventoryStockService');
    this.client = new service(config.address, config.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure());
  }

  async sendPending(): Promise<number> {
    if (this.running) return this.running;
    this.running = (async () => (await this.sendPushes()) + (await this.sendStream()))().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private pending(m: { query: DataSource['query'] }, metodo: 'PUSH' | 'STREAM', limit: number): Promise<PendingRow[]> {
    return m.query(
      `SELECT s.id, s.event_id, s.metodo, s.cupos_disponibles, s.delta, s.generado_en, t.atraccion_codigo, t.fecha::text AS fecha, t.hora::text AS hora
         FROM ${S}.sincronizacion_booking s JOIN ${S}.turnos_aforo t ON t.id = s.turno_id
        WHERE s.estado <> 'ENVIADO' AND s.metodo = $1 AND ${BACKOFF}
        ORDER BY s.generado_en, s.id LIMIT $2 FOR UPDATE OF s SKIP LOCKED`,
      [metodo, limit],
    );
  }

  private async mark(m: { query: DataSource['query'] }, ids: string[], ok: boolean, respuesta: string): Promise<void> {
    await m.query(
      `UPDATE ${S}.sincronizacion_booking SET estado = $2, respuesta = $3, procesado_en = now(), intentos = intentos + $4
        WHERE id = ANY($1::uuid[])`,
      [ids, ok ? 'ENVIADO' : 'ERROR', respuesta.slice(0, 500), ok ? 0 : 1],
    );
  }

  private async sendPushes(): Promise<number> {
    return this.dataSource.transaction(async (m) => {
      let sent = 0;
      for (const row of await this.pending(m, 'PUSH', 100)) {
        try {
          const ack = await callUnary<object, { success: boolean; message: string }>(this.client, 'PushStockUpdate', {
            service_id: this.config.serviceId,
            item_id: row.atraccion_codigo.trim(),
            date: row.fecha,
            time_slot: timeLabel(row.hora),
            available_units: row.cupos_disponibles ?? 0,
            timestamp: new Date(row.generado_en).getTime(),
          }, { deadlineMs: 3000 });
          await this.mark(m, [row.id], ack.success, ack.message ?? '');
          if (ack.success) sent++;
        } catch (error) {
          await this.mark(m, [row.id], false, error instanceof Error ? error.message : String(error));
          this.logger.warn('Booking no recibió el PushStockUpdate; se reintentará', { event_id: row.event_id, ...errorFields(error) });
          break; // Booking no responde: los demás esperan al siguiente intento
        }
      }
      return sent;
    });
  }

  private async sendStream(): Promise<number> {
    return this.dataSource.transaction(async (m) => {
      const rows = await this.pending(m, 'STREAM', 500);
      if (rows.length === 0) return 0;
      try {
        const summary = await new Promise<{ total_events_processed: number }>((resolve, reject) => {
          const call = (this.client as unknown as { StreamInventoryChanges: Function }).StreamInventoryChanges(
            new grpc.Metadata(),
            { deadline: new Date(Date.now() + 10_000) },
            (error: grpc.ServiceError | null, response: { total_events_processed: number }) => (error ? reject(error) : resolve(response)),
          );
          for (const row of rows) {
            call.write({
              event_id: row.event_id, service_id: this.config.serviceId, item_id: row.atraccion_codigo.trim(), date: row.fecha,
              time_slot: timeLabel(row.hora), delta: row.delta ?? 0, timestamp: new Date(row.generado_en).getTime(),
            });
          }
          call.end();
        });
        await this.mark(m, rows.map((r) => r.id), true, `StreamInventoryChanges: ${summary.total_events_processed} eventos`);
        return rows.length;
      } catch (error) {
        await this.mark(m, rows.map((r) => r.id), false, error instanceof Error ? error.message : String(error));
        this.logger.warn('Booking no recibió el StreamInventoryChanges; se reintentará', { eventos: rows.length, ...errorFields(error) });
        return 0;
      }
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sendPending().catch((error) => this.logger.error('falló la sincronización con Booking', errorFields(error))), this.config.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client.close();
  }
}
