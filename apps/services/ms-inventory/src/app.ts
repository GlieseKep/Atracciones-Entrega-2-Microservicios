import {
  AppError,
  checkNodeHealth,
  createLogger,
  EsbClient,
  loadProto,
  serviceConstructor,
  unary,
  type DatabaseSettings,
  type grpc,
  type Logger,
} from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { businessNow, toAvailability } from './application/availability';
import {
  parseCode,
  parseCodes,
  parseDate,
  parseKey,
  parseOptionalDate,
  parsePositive,
  parseReason,
  parseSlotCode,
  parseTime,
} from './application/input';
import { ScheduleService } from './application/schedule-service';
import { SlotGenerator } from './application/slot-generator';
import type { ReserveSeatsRequest } from './contract';
import type { BookingStockConfig } from './integration/booking-stock-client';
import { AvailabilityRepository } from './persistence/availability-repository';
import { ScheduleRepository } from './persistence/schedule-repository';
import { SeatRepository } from './persistence/seat-repository';

export interface MsInventoryConfig {
  grpcPort: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  esbUrl: string;
  booking: BookingStockConfig;
  bookingSyncEnabled: boolean;
  nodeId: string;
  nodeCode: string;
}

export function readMsInventoryConfig(env: NodeJS.ProcessEnv = process.env): MsInventoryConfig {
  return {
    grpcPort: Number(env.GRPC_PORT ?? 50067),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_inventory', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    booking: {
      address: env.BOOKING_STOCK_GRPC ?? 'localhost:50051',
      tls: env.BOOKING_STOCK_TLS === 'true',
      serviceId: env.BOOKING_SERVICE_ID ?? 'NODE_ATR_DILAN',
    },
    bookingSyncEnabled: env.BOOKING_SYNC_ENABLED !== 'false',
    nodeId: env.NODE_ID ?? 'node-dilan-inventory-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_INVENTORY',
  };
}

export interface MsInventoryDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

export interface MsInventoryService {
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  generator: SlotGenerator;
}

const VERSION = '1.0.0';

type Message = Record<string, unknown>;

/** Inventory & Availability Service (gRPC, contrato `Plan/ms_inventory/inventory.proto`): horarios, turnos y aforo. */
export function createMsInventoryService(config: MsInventoryConfig, dataSource: DataSource, deps: MsInventoryDependencies = {}): MsInventoryService {
  const logger = deps.logger ?? createLogger('ms-inventory');
  const esb = deps.esb ?? new EsbClient(config.esbUrl);
  const availability = new AvailabilityRepository(dataSource);
  const seats = new SeatRepository(dataSource);
  const schedules = new ScheduleRepository(dataSource);
  const generator = new SlotGenerator(schedules, logger);
  const service = new ScheduleService(schedules, generator, esb, config.internalTokenSecret);

  const definition = serviceConstructor(loadProto('internal/ms-inventory.proto'), 'descubre.inventory.InventoryService').service;

  const rpc = (method: string, handler: (request: Message) => Promise<unknown>) => unary(method, handler, logger);

  const implementation: grpc.UntypedServiceImplementation = {
    Health: rpc('Health', () => checkNodeHealth('ms-inventory', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION })),

    GetAvailability: rpc('GetAvailability', async (request) => {
      const date = parseDate(request.date, 'date');
      const codigo = String(request.id ?? '');
      if (!(await availability.hasSchedules(codigo))) throw AppError.notFound(`No existe la atracción ${codigo}.`, 'ATTRACTION_NOT_FOUND');
      const { today, now } = businessNow();
      return toAvailability(codigo, date, await availability.slots(codigo, date, today, now));
    }),

    FilterAvailableAttractions: rpc('FilterAvailableAttractions', async (request) => {
      const codigos = parseCodes(request.atraccion_ids);
      const from = parseDate(request.fecha_inicio, 'fecha_inicio');
      const to = parseDate(request.fecha_fin, 'fecha_fin');
      const { today, now } = businessNow();
      return { atraccion_ids: codigos.length === 0 ? [] : await availability.withSeats(codigos, from, to, today, now) };
    }),

    ReserveSeats: rpc('ReserveSeats', async (request) => {
      const r = request as unknown as ReserveSeatsRequest;
      return seats.reserve(parseCode(r.atraccion_id), parseSlotCode(r.slot_id), parsePositive(r.cantidad, 'cantidad'), parseKey(r.clave_idempotencia));
    }),

    ReleaseSeats: rpc('ReleaseSeats', (request) => seats.release(parseKey(request.clave_idempotencia))),

    GetSlotsByIds: rpc('GetSlotsByIds', async (request) => {
      const ids = Array.isArray(request.dis_ids) ? request.dis_ids.map(Number) : [];
      return { items: ids.length === 0 ? [] : await schedules.slotsByIds(ids) };
    }),

    ListSchedules: rpc('ListSchedules', async (request) => {
      const codigo = parseCode(request.atraccion_id);
      await service.requireStaff(codigo);
      return { items: await schedules.listSchedules(codigo) };
    }),

    SaveSchedule: rpc('SaveSchedule', (request) =>
      service.save(Number(request.hor_id ?? 0), parseCode(request.atraccion_id), parseTime(request.hora), parsePositive(request.cupo, 'cupo')),
    ),

    SetScheduleActive: rpc('SetScheduleActive', (request) => service.setActive(parsePositive(Number(request.hor_id), 'hor_id'), request.activo === true)),

    ListSlots: rpc('ListSlots', async (request) => {
      const codigo = parseCode(request.atraccion_id);
      await service.requireStaff(codigo);
      const page = Number(request.page) || 1;
      const limit = Math.min(Number(request.limit) || 50, 200);
      const { total, items } = await schedules.listSlots(codigo, parseOptionalDate(request.desde, 'desde'), parseOptionalDate(request.hasta, 'hasta'), page, limit);
      return { total_results: total, items };
    }),

    SetSlotCapacity: rpc('SetSlotCapacity', (request) =>
      service.setCapacity(parseCode(request.atraccion_id), parseSlotCode(request.slot_id), parsePositive(request.cupo_total, 'cupo_total')),
    ),

    SetSlotClosed: rpc('SetSlotClosed', async (request) => {
      const codigo = parseCode(request.atraccion_id);
      await service.requireStaff(codigo);
      return schedules.setSlotClosed(codigo, parseSlotCode(request.slot_id), request.cerrada === true);
    }),

    ListBlockedDates: rpc('ListBlockedDates', async (request) => {
      const codigo = parseCode(request.atraccion_id);
      await service.requireStaff(codigo);
      return { items: await schedules.listBlockedDates(codigo, parseOptionalDate(request.desde, 'desde'), parseOptionalDate(request.hasta, 'hasta')) };
    }),

    BlockDate: rpc('BlockDate', async (request) => {
      const codigo = parseCode(request.atraccion_id);
      await service.requireStaff(codigo);
      return schedules.blockDate(codigo, parseDate(request.fecha, 'fecha'), parseReason(request.motivo));
    }),

    UnblockDate: rpc('UnblockDate', async (request) => {
      await service.unblock(parseCode(request.atraccion_id), parseDate(request.fecha, 'fecha'));
      return {};
    }),
  };

  return { definition, implementation, generator };
}
