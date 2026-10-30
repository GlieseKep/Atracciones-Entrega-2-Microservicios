import { callUnary, grpc, loadProto, outgoingMetadata, serviceConstructor } from '@atracciones/platform';
import type { StockPayload } from '../contract';

export interface BookingStockConfig {
  /** `host:puerto` del gRPC de Booking Prototipo. */
  address: string;
  tls: boolean;
  /** Código de la tienda en Booking. */
  serviceId: string;
}

interface StockUpdateAck {
  success: boolean;
  message: string;
  error_code: string;
}

export type PushResult = 'delivered' | 'rejected' | 'retry';

const DEADLINE_MS = 5000;

/** Cliente de `inventory.InventoryStockService` (`Plan/PlanBooking/inventory.proto`). */
export class BookingStockClient {
  private readonly client: grpc.Client;

  constructor(private readonly config: BookingStockConfig) {
    const service = serviceConstructor(loadProto('booking/inventory.proto'), 'inventory.InventoryStockService');
    this.client = new service(config.address, config.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure());
  }

  /** `delivered` incluye `STALE_TIMESTAMP_IGNORED`. `rejected` es un dato que Booking nunca aceptará: reintentarlo no sirve. */
  async push(stock: StockPayload): Promise<{ result: PushResult; detail: string }> {
    const ack = await callUnary<object, StockUpdateAck>(
      this.client,
      'PushStockUpdate',
      {
        service_id: this.config.serviceId,
        item_id: stock.item_id,
        date: stock.date,
        time_slot: stock.time_slot,
        available_units: stock.available_units,
        timestamp: stock.timestamp,
        slot_id: stock.slot_id,
      },
      { deadlineMs: DEADLINE_MS },
    );
    if (ack.success || ack.error_code === 'STALE_TIMESTAMP_IGNORED') return { result: 'delivered', detail: ack.message };
    if (ack.error_code === 'ITEM_NOT_FOUND' || ack.error_code === 'INVALID_SLOT') return { result: 'rejected', detail: `${ack.error_code}: ${ack.message}` };
    return { result: 'retry', detail: `${ack.error_code}: ${ack.message}` };
  }

  /** Envía un lote por un solo canal y espera el resumen de Booking. */
  stream(events: { eventId: string; stock: StockPayload }[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const open = (this.client as unknown as Record<string, Function>).StreamInventoryChanges.bind(this.client);
      const call = open(outgoingMetadata(), { deadline: new Date(Date.now() + DEADLINE_MS * 4) }, (error: grpc.ServiceError | null) => (error ? reject(error) : resolve()));
      for (const { eventId, stock } of events) {
        call.write({
          event_id: eventId,
          service_id: this.config.serviceId,
          item_id: stock.item_id,
          date: stock.date,
          time_slot: stock.time_slot,
          delta: stock.delta,
          timestamp: stock.timestamp,
          slot_id: stock.slot_id,
        });
      }
      call.end();
    });
  }
}
