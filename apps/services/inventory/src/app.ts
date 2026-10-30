import { createHash } from 'node:crypto';
import {
  addDays,
  AppError,
  BUSINESS_TIME_ZONE,
  checkHealth,
  clientStream,
  createLogger,
  loadProto,
  normalizeTime,
  paging,
  requireAdmin,
  serviceConstructor,
  todayIn,
  toServiceError,
  unary,
  type DatabaseSettings,
  type grpc,
  type Logger,
} from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { BookingSyncConfig } from './application/booking-stock-sync';
import { InventoryAdminRepository } from './persistence/inventory-admin-repository';
import { InventoryRepository, type Clock, type TariffRow } from './persistence/inventory-repository';
import { seedInventory } from './persistence/seed';

export interface InventoryConfig {
  grpcPort: number;
  database: DatabaseSettings;
  timeZone: string;
  /** Días hacia adelante para los que se generan turnos a partir de los horarios. */
  slotDays: number;
  seedCatalog: boolean;
  /** Envío de stock a Booking Prototipo (contrato §2.2). */
  bookingSync: BookingSyncConfig & { enabled: boolean };
  /** Verifica el principal interno de las operaciones de administración. */
  internalTokenSecret: string;
}

export function readInventoryConfig(env: NodeJS.ProcessEnv = process.env): InventoryConfig {
  return {
    grpcPort: Number(env.GRPC_PORT ?? 50061),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/inventory_db', ssl: env.DATABASE_SSL === 'true' },
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
    slotDays: Number(env.SLOT_DAYS ?? 60),
    seedCatalog: (env.SEED_CATALOG ?? 'true') === 'true',
    bookingSync: {
      enabled: (env.BOOKING_SYNC_ENABLED ?? 'true') === 'true',
      address: env.BOOKING_STOCK_GRPC ?? 'localhost:50051',
      tls: env.BOOKING_STOCK_TLS === 'true',
      serviceId: env.BOOKING_SERVICE_ID ?? 'atracciones-dilan',
      intervalMs: Number(env.BOOKING_SYNC_INTERVAL_MS ?? 1000),
    },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
  };
}

/** Reloj del negocio (fecha y hora local de Ecuador). */
export const businessClock = (timeZone: string): Clock => ({
  now: () => {
    const now = new Date();
    const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
    return { date: todayIn(timeZone, now), time };
  },
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const requireDate = (value: string, name: string) => {
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw AppError.validation(`'${name}' debe ser una fecha YYYY-MM-DD.`, [{ name, reason: 'Formato YYYY-MM-DD.' }]);
  return value;
};
const requireTime = (value: string, name: string) => {
  const time = normalizeTime(value ?? '');
  if (!time) throw AppError.validation(`'${name}' debe ser una hora HH:mm:ss.`, [{ name, reason: 'Formato HH:mm:ss.' }]);
  return time;
};

const toTariff = (t: TariffRow) => ({
  atraccion_codigo: t.atraccion_codigo, moneda: t.moneda, adult: t.adult, child: t.child, senior: t.senior, infant: t.infant,
  student: t.student ?? 0, has_student: t.student !== null,
});

export const guideLabel = (g: { titulo: string | null; nombre: string; credencial_mintur: string | null }) =>
  `${g.titulo ? `${g.titulo} ` : ''}${g.nombre}${g.credencial_mintur ? ` (Credencial Mintur #${g.credencial_mintur})` : ''}`;

export interface InventoryService {
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  /** `inventory.InventoryStockService` (proto oficial del contrato) para recibir recargas de aforo (plan C7). */
  stockService: { definition: grpc.ServiceDefinition; implementation: grpc.UntypedServiceImplementation };
  repository: InventoryRepository;
  /** Carga el catálogo inicial (si está habilitado) y genera los turnos de los próximos días. */
  prepare(): Promise<{ seeded: number; slots: number }>;
}

/** Inventory & Availability Service (gRPC, plan §3.3). Único dueño de los cupos. */
export function createInventoryService(config: InventoryConfig, dataSource: DataSource, logger: Logger = createLogger('inventory')): InventoryService {
  const clock = businessClock(config.timeZone);
  const repository = new InventoryRepository(dataSource, clock);
  const adminRepository = new InventoryAdminRepository(dataSource, repository, clock);
  const admin = () => requireAdmin(config.internalTokenSecret);
  const service = serviceConstructor(loadProto('internal/inventory.proto'), 'atracciones.inventory.InventoryService');

  interface ReserveRequest { atraccion_codigo: string; fecha: string; hora: string; cantidad: number; orden_id: string; clave_idempotencia: string }
  const reserve = async (req: ReserveRequest) => {
    if (!(req.cantidad > 0)) throw AppError.validation('La cantidad de cupos debe ser mayor que cero.', [{ name: 'cantidad', reason: 'Mayor que cero.' }]);
    if (!req.clave_idempotencia) throw AppError.validation('Falta la clave de idempotencia del bloqueo.');
    const result = await repository.reserve({
      codigo: req.atraccion_codigo, fecha: requireDate(req.fecha, 'fecha'), hora: requireTime(req.hora, 'hora'),
      cantidad: req.cantidad, ordenId: req.orden_id, clave: req.clave_idempotencia,
    });
    return { reserva_cupo_id: result.reservaCupoId, cupos_disponibles: result.disponibles, guia_codigo: result.guiaCodigo ?? '' };
  };

  const implementation: grpc.UntypedServiceImplementation = {
    Health: unary('Health', async () => checkHealth('inventory', dataSource), logger),

    GetAvailability: unary<{ atraccion_codigo: string; fecha: string }, object>('GetAvailability', async (req) => {
      const fecha = requireDate(req.fecha, 'fecha');
      const turnos = await repository.availability(req.atraccion_codigo, fecha);
      return {
        atraccion_codigo: req.atraccion_codigo,
        fecha,
        turnos: turnos.map((t) => ({ ...t, precio_adulto: t.precio_adulto ?? 0, precio_nino: t.precio_nino ?? 0, guia_codigo: t.guia_codigo ?? '' })),
      };
    }, logger),

    GetTariff: unary<{ atraccion_codigo: string; fecha: string }, object>('GetTariff', async (req) => {
      const fecha = req.fecha ? requireDate(req.fecha, 'fecha') : clock.now().date;
      const [tariff] = await repository.tariffs([req.atraccion_codigo], fecha);
      if (!tariff) throw AppError.notFound(`La atracción ${req.atraccion_codigo} no tiene tarifa vigente el ${fecha}.`, 'TARIFF_NOT_FOUND');
      return toTariff(tariff);
    }, logger),

    GetTariffs: unary<{ atraccion_codigos: string[]; fecha: string }, object>('GetTariffs', async (req) => {
      const fecha = req.fecha ? requireDate(req.fecha, 'fecha') : clock.now().date;
      return { tarifas: (await repository.tariffs(req.atraccion_codigos ?? [], fecha)).map(toTariff) };
    }, logger),

    GetGuide: unary<{ codigo: string }, object>('GetGuide', async (req) => {
      const guide = await repository.guide(req.codigo);
      if (!guide) throw AppError.notFound(`No existe el guía ${req.codigo}.`, 'GUIDE_NOT_FOUND');
      return { codigo: guide.codigo, titulo: guide.titulo ?? '', nombre: guide.nombre, credencial_mintur: guide.credencial_mintur ?? '', nombre_visible: guideLabel(guide) };
    }, logger),

    HasAvailability: unary<{ atraccion_codigos: string[]; fecha_inicio: string; fecha_fin: string; cupos_minimos: number }, object>('HasAvailability', async (req) => {
      const desde = requireDate(req.fecha_inicio, 'fecha_inicio');
      const hasta = req.fecha_fin ? requireDate(req.fecha_fin, 'fecha_fin') : desde;
      if (hasta < desde) throw AppError.validation('fecha_fin no puede ser anterior a fecha_inicio.', [{ name: 'fecha_fin', reason: 'Debe ser igual o posterior a fecha_inicio.' }]);
      return { atraccion_codigos: await repository.withAvailability(req.atraccion_codigos ?? [], desde, hasta, Math.max(1, req.cupos_minimos || 1)) };
    }, logger),

    ReserveSeats: unary<ReserveRequest, object>('ReserveSeats', reserve, logger),

    ReleaseSeats: unary<{ clave_idempotencia: string }, object>('ReleaseSeats', async (req) => {
      const result = await repository.release(req.clave_idempotencia);
      return { liberado: result.liberado, cupos_disponibles: result.disponibles };
    }, logger),

    // Bloqueos en lote por un solo canal (D10): cada resultado sale en orden; el primer error cierra el stream con su estado.
    ReserveSeatsBatch: (call: grpc.ServerDuplexStream<ReserveRequest, object>) => {
      let queue = Promise.resolve();
      let failed = false;
      call.on('data', (req: ReserveRequest) => {
        queue = queue.then(async () => {
          if (failed) return;
          try {
            call.write(await reserve(req));
          } catch (error) {
            failed = true;
            call.emit('error', toServiceError(error, logger, 'ReserveSeatsBatch'));
          }
        });
      });
      call.on('end', () => void queue.then(() => !failed && call.end()));
    },

    ListSlots: unary<{ atraccion_codigo: string; fecha_desde: string; fecha_hasta: string; limit: number; offset: number }, object>('ListSlots', async (req) => {
      await admin();
      const desde = req.fecha_desde ? requireDate(req.fecha_desde, 'fecha_desde') : clock.now().date;
      const hasta = req.fecha_hasta ? requireDate(req.fecha_hasta, 'fecha_hasta') : addDays(desde, 30);
      return adminRepository.listSlots({ codigo: req.atraccion_codigo || null, desde, hasta, ...paging(req, 50, 500) });
    }, logger),

    UpsertSlots: unary<{ atraccion_codigo: string; fecha_desde: string; fecha_hasta: string; horas: string[]; cupos_totales: number; guia_codigo: string }, object>('UpsertSlots', async (req) => {
      await admin();
      const desde = requireDate(req.fecha_desde, 'fecha_desde');
      const hasta = req.fecha_hasta ? requireDate(req.fecha_hasta, 'fecha_hasta') : desde;
      if (hasta < desde || addDays(desde, 366) < hasta) throw AppError.validation('Rango de fechas inválido (máximo un año).', [{ name: 'fecha_hasta', reason: 'Igual o posterior a fecha_desde y como máximo un año después.' }]);
      if (desde < clock.now().date) throw AppError.validation('No se pueden crear turnos en el pasado.', [{ name: 'fecha_desde', reason: 'Debe ser hoy o una fecha futura.' }]);
      const horas = [...new Set((req.horas ?? []).map((h, i) => requireTime(h, `horas[${i}]`)))];
      if (horas.length === 0 || horas.length > 24) throw AppError.validation('Indique entre 1 y 24 horas.', [{ name: 'horas', reason: 'Entre 1 y 24 horas.' }]);
      if (!(req.cupos_totales >= 1 && req.cupos_totales <= 10_000)) throw AppError.validation('Aforo inválido.', [{ name: 'cupos_totales', reason: 'Entre 1 y 10000.' }]);
      return adminRepository.upsertSlots({ codigo: req.atraccion_codigo, desde, hasta, horas, cupos: req.cupos_totales, guiaCodigo: req.guia_codigo || null });
    }, logger),

    SetSlotCapacity: unary<{ atraccion_codigo: string; fecha: string; hora: string; cupos_totales: number }, object>('SetSlotCapacity', async (req) => {
      await admin();
      if (!(req.cupos_totales >= 0 && req.cupos_totales <= 10_000)) throw AppError.validation('Aforo inválido.', [{ name: 'cupos_totales', reason: 'Entre 0 y 10000.' }]);
      return adminRepository.setCapacity(req.atraccion_codigo, requireDate(req.fecha, 'fecha'), requireTime(req.hora, 'hora'), req.cupos_totales);
    }, logger),

    SetSlotClosed: unary<{ atraccion_codigo: string; fecha: string; hora: string; cerrado: boolean }, object>('SetSlotClosed', async (req) => {
      await admin();
      return adminRepository.setClosed(req.atraccion_codigo, requireDate(req.fecha, 'fecha'), requireTime(req.hora, 'hora'), req.cerrado === true);
    }, logger),

    SetTariff: unary<{ atraccion_codigo: string; moneda: string; adult: number; child: number; senior: number; infant: number; student: number; has_student: boolean; vigente_desde: string }, object>('SetTariff', async (req) => {
      await admin();
      const prices = { adult: req.adult, child: req.child, senior: req.senior, infant: req.infant, ...(req.has_student ? { student: req.student } : {}) };
      const invalid = Object.entries(prices).filter(([, p]) => !(Number.isFinite(p) && p >= 0 && p <= 100_000)).map(([name]) => ({ name, reason: 'Precio entre 0 y 100000.' }));
      if (!(req.adult > 0)) invalid.push({ name: 'adult', reason: 'El precio de adulto debe ser mayor que cero.' });
      if (invalid.length) throw AppError.validation('La tarifa no es válida.', invalid);
      const vigente = req.vigente_desde ? requireDate(req.vigente_desde, 'vigente_desde') : clock.now().date;
      const round = (n: number) => Math.round(n * 100) / 100;
      await adminRepository.setTariff({
        atraccion_codigo: req.atraccion_codigo, moneda: req.moneda || 'USD', adult: round(req.adult), child: round(req.child), senior: round(req.senior), infant: round(req.infant),
        student: req.has_student ? round(req.student) : null, vigente_desde: vigente,
      });
      const [tariff] = await repository.tariffs([req.atraccion_codigo], vigente);
      return toTariff(tariff);
    }, logger),

    CapacitySummary: unary<{ fecha_desde: string; fecha_hasta: string }, object>('CapacitySummary', async (req) => {
      await admin();
      const desde = req.fecha_desde ? requireDate(req.fecha_desde, 'fecha_desde') : clock.now().date;
      return adminRepository.capacitySummary(desde, req.fecha_hasta ? requireDate(req.fecha_hasta, 'fecha_hasta') : addDays(desde, 30));
    }, logger),
  };

  // Recargas de aforo recibidas con el proto oficial: el mismo mensaje que la tienda envía a Booking.
  const stock = serviceConstructor(loadProto('booking/inventory.proto'), 'inventory.InventoryStockService');
  const adjust = async (m: { item_id: string; date: string; time_slot: string }, change: { available?: number; delta?: number }) => {
    const hora = requireTime(m.time_slot, 'time_slot');
    const disponibles = await repository.adjustCapacity({ codigo: m.item_id, fecha: requireDate(m.date, 'date'), hora, ...change });
    if (disponibles === null) throw AppError.notFound(`No existe el turno ${m.item_id} ${m.date} ${m.time_slot}.`, 'SLOT_NOT_FOUND');
    return disponibles;
  };
  const stockService = {
    definition: stock.service,
    implementation: {
      PushStockUpdate: unary<{ item_id: string; date: string; time_slot: string; available_units: number }, object>('PushStockUpdate', async (m) => {
        const disponibles = await adjust(m, { available: m.available_units });
        return { success: true, message: `Turno actualizado: ${disponibles} cupos disponibles.`, processed_at: Date.now() };
      }, logger),
      StreamInventoryChanges: clientStream<{ event_id: string; item_id: string; date: string; time_slot: string; delta: number }, object>('StreamInventoryChanges', async (events) => {
        const hash = createHash('sha256');
        let total = 0;
        for await (const e of events) {
          await adjust(e, { delta: e.delta });
          hash.update(e.event_id);
          total++;
        }
        return { total_events_processed: total, is_synchronized: true, last_sync_hash: hash.digest('hex') };
      }, logger),
    } as grpc.UntypedServiceImplementation,
  };

  return {
    definition: service.service,
    implementation,
    stockService,
    repository,
    async prepare() {
      const seeded = config.seedCatalog ? await seedInventory(dataSource) : 0;
      const today = clock.now().date;
      const slots = await repository.generateSlots(today, addDays(today, config.slotDays), config.bookingSync.enabled);
      return { seeded, slots };
    },
  };
}
