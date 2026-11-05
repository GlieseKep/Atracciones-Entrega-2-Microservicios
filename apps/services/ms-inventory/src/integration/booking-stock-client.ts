import { AppError, httpJson } from '@atracciones/platform';
import type { StockPayload } from '../contract';

export interface BookingStockConfig {
  /** `BOOKING_REST_STOCK_URL`: URL completa de `POST /api/v3/inventory/stock` en Booking Prototipo. */
  url: string;
  /** La clave de la tienda que se registra en Booking. */
  apiKey: string;
}

interface StockAck {
  success?: boolean;
  acknowledged?: boolean;
  message?: string;
  error_code?: string;
}

/** `not_found`: Booking aún no conoce la atracción (la conoce cuando consulta nuestra tienda), así que vale la pena reintentar. */
export type PushResult = 'delivered' | 'not_found' | 'rejected' | 'retry';

const TIMEOUT_MS = 5000;

/** Cliente REST del stock de Booking Prototipo (Parte 4, opción A, de la guía de socios). */
export class BookingStockClient {
  constructor(private readonly config: BookingStockConfig) {}

  /** Adónde se envía, para los logs. */
  get destination(): string {
    return this.config.url;
  }

  /** `delivered` incluye `STALE_TIMESTAMP_IGNORED`. `rejected` es un dato que Booking nunca aceptará: reintentarlo no sirve. */
  async push(stock: StockPayload): Promise<{ result: PushResult; detail: string }> {
    try {
      const { body } = await httpJson<StockAck>(this.config.url, {
        method: 'POST',
        headers: { 'x-api-key': this.config.apiKey },
        body: {
          item_id: stock.item_id,
          available_units: stock.available_units,
          date: stock.date,
          time_slot: stock.time_slot,
          timestamp: stock.timestamp,
        },
        timeoutMs: TIMEOUT_MS,
      });
      const detail = `${body?.error_code ?? ''} ${body?.message ?? ''}`.trim();
      if (body?.success || body?.acknowledged || body?.error_code === 'STALE_TIMESTAMP_IGNORED') return { result: 'delivered', detail };
      if (body?.error_code === 'ITEM_NOT_FOUND') return { result: 'not_found', detail };
      return { result: body?.error_code === 'INVALID_SLOT' ? 'rejected' : 'retry', detail };
    } catch (error) {
      // 401 y 403 se reintentan: la clave puede registrarse después en Booking.
      if (error instanceof AppError && error.status === 404) return { result: 'not_found', detail: error.message };
      if (error instanceof AppError && [400, 422].includes(error.status)) return { result: 'rejected', detail: error.message };
      throw error;
    }
  }
}
