import {
  AppError,
  checkNodeHealth,
  createLogger,
  EsbClient,
  hasRole,
  loadProto,
  requirePrincipal,
  serviceConstructor,
  unary,
  type DatabaseSettings,
  type EventHandler,
  type grpc,
  type Logger,
} from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { CancellationFlow } from './application/cancellation-flow';
import { CheckinService } from './application/checkin-service';
import { parseIdempotencyKey, parsePurchase, parseSolicitante, parseText } from './application/input';
import { Lifecycle } from './application/lifecycle';
import { paymentEventHandler } from './application/payment-events';
import { PurchaseFlow } from './application/purchase-flow';
import { Remote } from './application/remote';
import { ReservationService } from './application/reservation-service';
import { EVENT_TYPES, type EventType } from './contract';
import { EventRepository } from './persistence/event-repository';
import { IdempotencyRepository } from './persistence/idempotency-repository';
import { ReservationRepository } from './persistence/reservation-repository';

export interface MsBookingConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Protege `/internal/rpc`. */
  serviceToken: string;
  /** Firma del QR. */
  voucherSecret: string;
  esbUrl: string;
  /** Prefijo público de `_links`. */
  basePath: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsBookingConfig(env: NodeJS.ProcessEnv = process.env): MsBookingConfig {
  return {
    port: Number(env.PORT ?? 4023),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_booking', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    voucherSecret: env.VOUCHER_SECRET ?? '',
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    basePath: env.BASE_PATH ?? '/api/v3',
    nodeId: env.NODE_ID ?? 'node-dilan-booking-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_BOOKING',
  };
}

export interface MsBookingDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

export interface MsBookingService {
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  onEvent: EventHandler;
  lifecycle: Lifecycle;
  events: EventRepository;
}

const VERSION = '1.0.0';

type Message = Record<string, unknown>;

/** Booking Service (HTTP interno definido por el proto, contrato `Plan/ms_booking/booking.proto`): reservas, proceso de compra, check-in y feed de eventos. */
export function createMsBookingService(config: MsBookingConfig, dataSource: DataSource, deps: MsBookingDependencies = {}): MsBookingService {
  const logger = deps.logger ?? createLogger('ms-booking');
  const remote = new Remote(deps.esb ?? new EsbClient(config.esbUrl));
  const events = new EventRepository(dataSource);
  const reservations = new ReservationRepository(dataSource, events);
  const idempotency = new IdempotencyRepository(dataSource);
  const service = new ReservationService(reservations, remote, config.internalTokenSecret, config.basePath);
  const purchase = new PurchaseFlow(reservations, idempotency, remote, { internalToken: config.internalTokenSecret, voucher: config.voucherSecret }, config.basePath, logger);
  const cancellation = new CancellationFlow(reservations, idempotency, service, remote, config.internalTokenSecret);
  const checkin = new CheckinService(reservations, idempotency, remote, { internalToken: config.internalTokenSecret, voucher: config.voucherSecret });

  const definition = serviceConstructor(loadProto('internal/ms-booking.proto'), 'descubre.booking.BookingService').service;
  const rpc = (method: string, handler: (request: Message) => Promise<unknown>) => unary(method, handler, logger);

  async function listEvents(request: Message) {
    const principal = await requirePrincipal(config.internalTokenSecret);
    if (principal.tipo !== 'API_CLIENTE' && !hasRole(principal, 'ADMIN')) throw AppError.forbidden('El feed de eventos requiere credenciales de socio o el rol ADMIN.');
    const type = parseText(request.type);
    if (type && !EVENT_TYPES.includes(type as EventType)) throw AppError.validation(`'type' debe ser ${EVENT_TYPES.join(', ')}.`, [{ name: 'type', reason: 'Valor no permitido.' }]);
    const limit = Math.min(Number(request.limit) || 50, 200);
    const rows = await events.list(Number(request.after ?? 0), limit, type || null);
    return {
      events: rows.map((row) => ({
        specversion: row.evt_specversion,
        source: row.evt_fuente,
        event_id: row.evt_uuid,
        sequence_number: Number(row.evt_id),
        event_type: row.evt_tipo,
        aggregate_id: row.evt_aggregate_id,
        correlation_id: row.evt_correlation_id,
        timestamp: row.evt_creado_en.toISOString(),
        payload_json: JSON.stringify(row.evt_payload),
      })),
    };
  }

  const implementation: grpc.UntypedServiceImplementation = {
    Health: rpc('Health', () => checkNodeHealth('ms-booking', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION })),
    CreateReservation: rpc('CreateReservation', (request) => purchase.run(parsePurchase(request))),
    GetReservation: rpc('GetReservation', (request) => service.get(parseText(request.id))),
    CancelReservation: rpc('CancelReservation', (request) =>
      cancellation.run(parseIdempotencyKey(request.idempotency_key), parseText(request.id), parseText(request.reason), parseSolicitante(request.solicitante)),
    ),
    CheckIn: rpc('CheckIn', (request) => {
      const documento = parseText(request.documento_identidad);
      if (documento === '') throw AppError.validation("'documento_identidad' es obligatorio.", [{ name: 'documento_identidad', reason: 'Es obligatorio.' }]);
      return checkin.run({
        key: parseIdempotencyKey(request.idempotency_key),
        id: parseText(request.id),
        documento,
        voucher: parseText(request.codigo_voucher_qr) || null,
        guiaCodigo: parseText(request.guia_codigo) || null,
        dispositivo: parseText(request.scanner_device_id) || null,
      });
    }),
    ListEvents: rpc('ListEvents', listEvents),
    ListReservations: rpc('ListReservations', (request) => service.list(request.todas === true, parseText(request.estado), Number(request.page ?? 0), Number(request.limit ?? 0))),
  };

  return { definition, implementation, onEvent: paymentEventHandler(reservations, remote, logger), lifecycle: new Lifecycle(reservations, idempotency, remote, logger), events };
}
