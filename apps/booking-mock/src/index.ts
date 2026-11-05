import {
  AppError,
  clientStream,
  createHttpService,
  createLogger,
  listen,
  loadProto,
  serviceConstructor,
  startGrpcServer,
  unary,
  type GrpcServerHandle,
  type RunningServer,
} from '@atracciones/platform';
import { createHash } from 'node:crypto';

/** Mensajes del proto oficial (`packages/contracts/proto/booking/inventory.proto`). */
export interface StockUpdateMessage {
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  timestamp: number;
}

export interface StockChangeEvent {
  event_id: string;
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  delta: number;
  timestamp: number;
}

/** Aviso de check-in que Booking Central recibe en `POST /api/v3/reservas/{external_order_id}/checkin`. */
export interface CheckinNotice {
  external_order_id: string;
  body: Record<string, unknown>;
  received_at: string;
}

export interface BookingMock {
  grpcPort: number;
  /** Lo recibido, en orden de llegada. */
  received: { pushes: StockUpdateMessage[]; streamed: StockChangeEvent[]; checkins: CheckinNotice[] };
  /** Simula una caída de Booking: mientras esté en `true`, los RPC responden UNAVAILABLE. */
  setDown(down: boolean): void;
  close(): Promise<void>;
}

const logger = createLogger('booking-mock');

/** Inicia el mock de Booking Prototipo en el puerto gRPC indicado (50051 en local; 0 = libre, para pruebas). */
export async function startBookingMock(port = 50051): Promise<BookingMock> {
  const proto = loadProto('booking/inventory.proto');
  const service = serviceConstructor(proto, 'inventory.InventoryStockService');
  const received: BookingMock['received'] = { pushes: [], streamed: [], checkins: [] };
  let down = false;
  const unavailable = () => AppError.unavailable('Booking simulado fuera de servicio.');

  const server: GrpcServerHandle = await startGrpcServer(
    [
      {
        definition: service.service,
        implementation: {
          PushStockUpdate: unary<StockUpdateMessage, object>('PushStockUpdate', async (message) => {
            if (down) throw unavailable();
            received.pushes.push(message);
            logger.info('PushStockUpdate recibido', { ...message });
            return { success: true, message: 'Stock actualizado en Booking Prototipo (mock).', processed_at: Date.now() };
          }, logger),
          StreamInventoryChanges: clientStream<StockChangeEvent, object>('StreamInventoryChanges', async (events) => {
            if (down) throw unavailable();
            const hash = createHash('sha256');
            let total = 0;
            for await (const event of events) {
              received.streamed.push(event);
              hash.update(event.event_id);
              total++;
            }
            logger.info('StreamInventoryChanges recibido', { total });
            return { total_events_processed: total, is_synchronized: true, last_sync_hash: hash.digest('hex') };
          }, logger),
        },
      },
    ],
    port,
  );

  return {
    grpcPort: server.port,
    received,
    setDown: (value) => {
      down = value;
    },
    close: () => server.close(),
  };
}

/**
 * HTTP de desarrollo local: `GET /received` (lo recibido) y el aviso de check-in de Booking Central
 * (`POST /api/v3/reservas/{external_order_id}/checkin`), que exige `X-API-Key` (la de `BOOKING_CORE_API_KEY`, si se fija).
 */
export async function startInspectionServer(mock: BookingMock, port: number, apiKey = process.env.BOOKING_CORE_API_KEY ?? ''): Promise<RunningServer> {
  const app = createHttpService({
    service: 'booking-mock',
    routes: (a) => {
      a.get('/received', (_req, res) => {
        res.json(mock.received);
      });
      a.post('/api/v3/reservas/:externalOrderId/checkin', (req, res) => {
        const key = req.get('x-api-key') ?? '';
        if (!key || (apiKey && key !== apiKey)) throw AppError.unauthorized('Falta la X-API-Key o no es válida.');
        const externalOrderId = String(req.params.externalOrderId);
        if (mock.received.checkins.some((c) => c.external_order_id === externalOrderId)) {
          throw AppError.conflict('CHECKIN_ALREADY_REGISTERED', `El check-in de ${externalOrderId} ya estaba registrado.`);
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        mock.received.checkins.push({ external_order_id: externalOrderId, body, received_at: new Date().toISOString() });
        logger.info('check-in recibido', { external_order_id: externalOrderId, client_id: body.client_id });
        res.json({ acknowledged: true, status: 'CONFIRMADO_ASISTIDO' });
      });
    },
  });
  return listen(app, port);
}
