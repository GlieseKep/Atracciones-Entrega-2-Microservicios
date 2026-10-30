import {
  AppError,
  checkNodeHealth,
  createLogger,
  EsbClient,
  hasRole,
  loadProto,
  requirePrincipal,
  serviceConstructor,
  todayIn,
  unary,
  type DatabaseSettings,
  type grpc,
  type Logger,
} from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { parseBoletos, parseCode, parseDate, parseSetPriceTable } from './application/input';
import { priceTableOf, toTariff } from './application/price-table';
import { buildQuote } from './application/quote';
import type { GetPriceTableRequest, ListTariffsRequest, QuoteTicketsRequest, SetPriceTableRequest } from './contract';
import { PricingRepository } from './persistence/pricing-repository';

export interface MsPricingConfig {
  grpcPort: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  esbUrl: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsPricingConfig(env: NodeJS.ProcessEnv = process.env): MsPricingConfig {
  return {
    grpcPort: Number(env.GRPC_PORT ?? 50062),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_pricing', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    nodeId: env.NODE_ID ?? 'node-dilan-pricing-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_PRICING',
  };
}

export interface MsPricingDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

export interface MsPricingService {
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  repository: PricingRepository;
}

const VERSION = '1.0.0';

/** Pricing Service (gRPC, contrato `Plan/ms_pricing/pricing.proto`): tarifas versionadas por atracción y tipo de boleto. */
export function createMsPricingService(config: MsPricingConfig, dataSource: DataSource, deps: MsPricingDependencies = {}): MsPricingService {
  const logger = deps.logger ?? createLogger('ms-pricing');
  const esb = deps.esb ?? new EsbClient(config.esbUrl);
  const repository = new PricingRepository(dataSource);

  /**
   * `ADMIN`, u `OPERADOR` de la atracción. Pricing no sabe de quién es cada atracción: lo responde la ruta de
   * administración de Catalog, que con el principal propagado da `403` a otro operador.
   */
  async function requireAttractionStaff(codigo: string): Promise<void> {
    const principal = await requirePrincipal(config.internalTokenSecret);
    if (hasRole(principal, 'ADMIN')) return;
    if (!hasRole(principal, 'OPERADOR')) throw AppError.forbidden('Esta operación requiere el rol ADMIN u OPERADOR.');
    await esb.call('catalog', 'adminGetAttraction', { id: codigo });
  }

  const proto = loadProto('internal/pricing.proto');
  const definition = serviceConstructor(proto, 'descubre.pricing.PricingService').service;

  const implementation: grpc.UntypedServiceImplementation = {
    Health: unary('Health', () => checkNodeHealth('ms-pricing', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION }), logger),

    QuoteTickets: unary(
      'QuoteTickets',
      async (request: QuoteTicketsRequest) => {
        const codigo = parseCode(request.attraction_id);
        const date = parseDate(request.date, 'date');
        return buildQuote(codigo, date, parseBoletos(request), await repository.forDate(codigo, date));
      },
      logger,
    ),

    GetPriceTable: unary(
      'GetPriceTable',
      async (request: GetPriceTableRequest) => {
        const codigo = parseCode(request.attraction_id);
        const date = request.date ? parseDate(request.date, 'date') : todayIn();
        const table = priceTableOf(codigo, date, await repository.forDate(codigo, date));
        if (!table) throw AppError.notFound(`La atracción ${codigo} no tiene tarifa vigente el ${date}.`, 'PRICE_TABLE_NOT_FOUND');
        return table;
      },
      logger,
    ),

    ListTariffs: unary(
      'ListTariffs',
      async (request: ListTariffsRequest) => {
        const codigo = parseCode(request.attraction_id);
        await requireAttractionStaff(codigo);
        const today = todayIn();
        return { items: (await repository.list(codigo, request.include_history, today)).map((row) => toTariff(row, today)) };
      },
      logger,
    ),

    SetPriceTable: unary(
      'SetPriceTable',
      async (request: SetPriceTableRequest) => {
        const today = todayIn();
        const input = parseSetPriceTable(request, today);
        await requireAttractionStaff(input.codigo);
        return priceTableOf(input.codigo, input.validFrom, await repository.setPriceTable(input, today));
      },
      logger,
    ),
  };

  return { definition, implementation, repository };
}
