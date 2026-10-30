import {
  AppError,
  BUSINESS_TIME_ZONE,
  checkHealth,
  createLogger,
  loadProto,
  requireAdmin,
  serviceConstructor,
  todayIn,
  unary,
  type DatabaseSettings,
  type grpc,
  type Logger,
} from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { currencyOr, dateOr, MAX_BATCH, optionalDate, requireCode, requireCounts, requirePrice, requireTicketType } from './application/input';
import { buildPriceTable, type TariffRow } from './application/price-table';
import { buildQuote } from './application/quote';
import type {
  CloseTariffRequest,
  PriceTable,
  PriceTableList,
  Quote,
  SetPriceTableRequest,
  SetTariffRequest,
  Tariff,
  TariffList,
  TariffUpdatedPayload,
  TicketType,
} from './contract';
import { PricingRepository } from './persistence/pricing-repository';

export interface MsPricingConfig {
  grpcPort: number;
  database: DatabaseSettings;
  /** Verifica el principal interno de las operaciones de administración. */
  internalTokenSecret: string;
  timeZone: string;
}

export function readMsPricingConfig(env: NodeJS.ProcessEnv = process.env): MsPricingConfig {
  return {
    grpcPort: Number(env.GRPC_PORT ?? 50062),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_pricing', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
  };
}

export interface MsPricingService {
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  repository: PricingRepository;
}

/** Tipos que la tabla de precios exige siempre (`TarifaBaseDesglosada` del contrato v3); STUDENT es opcional. */
const REQUIRED_IN_TABLE: TicketType[] = ['ADULT', 'CHILD', 'SENIOR', 'INFANT'];

const toTariff = (row: TariffRow, today: string): Tariff => ({
  tariff_id: row.tar_id,
  attraction_id: row.atr_codigo,
  ticket_type: row.tar_tipo,
  price: row.tar_precio,
  currency: row.tar_moneda,
  valid_from: row.valid_from,
  valid_to: row.valid_to ?? '',
  current: row.valid_from <= today && (row.valid_to === null || row.valid_to >= today),
});

/**
 * Pricing Service (gRPC, contrato `Plan/ms_pricing/pricing.proto`). Dueño de las tarifas: las consultas son abiertas
 * (las usan Catalog, Inventory, Order y la Partner API por el ESB); la administración exige el scope de administrador.
 */
export function createMsPricingService(
  config: MsPricingConfig,
  dataSource: DataSource,
  logger: Logger = createLogger('ms-pricing'),
  now: () => Date = () => new Date(),
): MsPricingService {
  const repository = new PricingRepository(dataSource);
  const service = serviceConstructor(loadProto('internal/pricing.proto'), 'atracciones.pricing.PricingService');
  const today = () => todayIn(config.timeZone, now());
  const admin = () => requireAdmin(config.internalTokenSecret);

  const tableAt = async (code: string, date: string, m?: EntityManager) => buildPriceTable(code, date, await repository.currentRows([code], date, m));

  /** Una vigencia nueva no puede empezar en el pasado: el historial de precios no se reescribe. */
  const validFrom = (value: unknown) => {
    const date = dateOr(value, today(), 'valid_from');
    if (date < today()) throw AppError.validation('La vigencia no puede empezar en el pasado.', [{ name: 'valid_from', reason: `Hoy (${today()}) o una fecha futura.` }]);
    return date;
  };

  /** TARIFA_ACTUALIZADA con la tabla vigente hoy, en la misma transacción que el cambio. */
  const publishChange = async (m: EntityManager, code: string, from: string) => {
    const payload: TariffUpdatedPayload = { attraction_id: code, valid_from: from, current_prices: await tableAt(code, today(), m) };
    await repository.recordTariffUpdated(m, code, payload as unknown as Record<string, unknown>);
  };

  const implementation: grpc.UntypedServiceImplementation = {
    Health: unary('Health', async () => checkHealth('ms-pricing', dataSource), logger),

    GetPriceTable: unary<{ attraction_id: string; date: string }, PriceTable>('GetPriceTable', async (req) => {
      const code = requireCode(req.attraction_id);
      return tableAt(code, dateOr(req.date, today(), 'date'));
    }, logger),

    GetPriceTables: unary<{ attraction_ids: string[]; date: string }, PriceTableList>('GetPriceTables', async (req) => {
      const ids = [...new Set(req.attraction_ids ?? [])];
      if (ids.length > MAX_BATCH) {
        throw AppError.validation(`Máximo ${MAX_BATCH} atracciones por consulta.`, [{ name: 'attraction_ids', reason: `Hasta ${MAX_BATCH} códigos.` }]);
      }
      const codes = ids.map((id, i) => requireCode(id, `attraction_ids[${i}]`));
      const date = dateOr(req.date, today(), 'date');
      const byCode = new Map<string, TariffRow[]>();
      for (const row of await repository.currentRows(codes, date)) byCode.set(row.atr_codigo, [...(byCode.get(row.atr_codigo) ?? []), row]);
      // Solo las atracciones con al menos una tarifa vigente.
      return { items: codes.filter((c) => byCode.has(c)).map((c) => buildPriceTable(c, date, byCode.get(c)!)) };
    }, logger),

    QuoteTickets: unary<Record<string, unknown>, Quote>('QuoteTickets', async (req) => {
      const code = requireCode(req.attraction_id);
      const date = dateOr(req.date, today(), 'date');
      const counts = requireCounts(req);
      return buildQuote(code, date, counts, await repository.currentRows([code], date));
    }, logger),

    ListTariffs: unary<{ attraction_id: string; include_history: boolean }, TariffList>('ListTariffs', async (req) => {
      await admin();
      const code = requireCode(req.attraction_id);
      const date = today();
      return { items: (await repository.list(code, Boolean(req.include_history), date)).map((r) => toTariff(r, date)) };
    }, logger),

    SetPriceTable: unary<SetPriceTableRequest, PriceTable>('SetPriceTable', async (req) => {
      await admin();
      const code = requireCode(req.attraction_id);
      const currency = currencyOr(req.currency);
      const from = validFrom(req.valid_from);
      if (!(typeof req.adult === 'number' && req.adult > 0)) {
        throw AppError.validation('La tabla de precios debe incluir la tarifa de adulto (mayor que 0).', [{ name: 'adult', reason: 'Mayor que 0.' }], 'TARIFF_INCOMPLETE');
      }
      const prices = new Map<TicketType, number>(REQUIRED_IN_TABLE.map((t) => [t, requirePrice(req[t.toLowerCase() as 'adult' | 'child' | 'senior' | 'infant'], t, t.toLowerCase())]));
      const hasStudent = req.student !== undefined && req.student !== null;
      if (hasStudent) prices.set('STUDENT', requirePrice(req.student, 'STUDENT', 'student'));

      return repository.change(async (m) => {
        for (const [type, price] of prices) await repository.putVersion(m, { code, type, price, currency, from, to: null });
        // Sin precio de estudiante, deja de haber tarifa de estudiante desde esa fecha.
        if (!hasStudent) await repository.endType(m, code, 'STUDENT', from);
        await publishChange(m, code, from);
        return tableAt(code, from, m);
      });
    }, logger),

    SetTariff: unary<SetTariffRequest, Tariff>('SetTariff', async (req) => {
      await admin();
      const code = requireCode(req.attraction_id);
      const type = requireTicketType(req.ticket_type);
      const price = requirePrice(req.price, type);
      const currency = currencyOr(req.currency);
      const from = validFrom(req.valid_from);
      const to = optionalDate(req.valid_to, 'valid_to');
      if (to && to < from) throw AppError.validation('La vigencia no puede terminar antes de empezar.', [{ name: 'valid_to', reason: `Igual o posterior a ${from}.` }]);

      return repository.change(async (m) => {
        const row = await repository.putVersion(m, { code, type, price, currency, from, to });
        await publishChange(m, code, from);
        return toTariff(row, today());
      });
    }, logger),

    CloseTariff: unary<CloseTariffRequest, Tariff>('CloseTariff', async (req) => {
      await admin();
      const id = Number(req.tariff_id);
      if (!Number.isInteger(id) || id <= 0) throw AppError.validation('tariff_id no es válido.', [{ name: 'tariff_id', reason: 'Entero mayor que 0.' }]);
      const to = dateOr(req.valid_to, '', 'valid_to');
      if (!to) throw AppError.validation('Falta la fecha de fin de vigencia.', [{ name: 'valid_to', reason: 'Fecha YYYY-MM-DD.' }]);

      return repository.change(async (m) => {
        const current = await repository.getById(id, m, true);
        if (!current) throw AppError.notFound(`No existe la tarifa ${id}.`, 'TARIFF_NOT_FOUND');
        if (to < current.valid_from) {
          throw AppError.validation('La vigencia no puede terminar antes de empezar.', [{ name: 'valid_to', reason: `Igual o posterior a ${current.valid_from}.` }]);
        }
        const row = await repository.setValidTo(m, id, to);
        await publishChange(m, row.atr_codigo, row.valid_from);
        return toTariff(row, today());
      });
    }, logger),
  };

  return { definition: service.service, implementation, repository };
}
