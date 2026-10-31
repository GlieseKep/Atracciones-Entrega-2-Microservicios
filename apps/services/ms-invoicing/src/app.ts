import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  EsbClient,
  hasRole,
  requirePrincipal,
  requireServiceToken,
  type DatabaseSettings,
  type EventHandler,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express, type RequestHandler } from 'express';
import type { DataSource } from 'typeorm';
import { InvoiceService } from './application/invoice-service';
import { SriQueue } from './application/sri-queue';
import { INVOICE_STATES, SRI_STATES, type Issuer } from './contract';
import { INVOICING_BASE_PATH } from './integration/esb-routes';
import { InvoiceRepository } from './persistence/invoice-repository';

export interface MsInvoicingConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Cabecera `X-Service-Token` de los demás servicios. */
  serviceToken: string;
  basePath: string;
  esbUrl: string;
  issuer: Issuer;
  ivaPorcentaje: number;
  correoDefecto: string;
  sriMaxPorMinuto: number;
  nodeId: string;
  nodeCode: string;
}

export function readMsInvoicingConfig(env: NodeJS.ProcessEnv = process.env): MsInvoicingConfig {
  return {
    port: Number(env.PORT ?? 4021),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_invoicing', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    basePath: env.BASE_PATH ?? INVOICING_BASE_PATH,
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    issuer: {
      ambiente: '1',
      ruc: env.SRI_RUC ?? '1792348123001',
      razonSocial: env.SRI_RAZON_SOCIAL ?? 'Descubre EC',
      direccion: env.SRI_DIRECCION ?? 'Quito, Ecuador',
    },
    ivaPorcentaje: Number(env.IVA_PORCENTAJE ?? 15),
    correoDefecto: env.FACTURA_CORREO_DEFECTO ?? 'facturas@descubreec.com',
    sriMaxPorMinuto: Number(env.SRI_MAX_POR_MINUTO ?? 30),
    nodeId: env.NODE_ID ?? 'node-dilan-invoicing-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_INVOICING',
  };
}

export interface MsInvoicingDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

export interface MsInvoicingService {
  app: Express;
  onEvent: EventHandler;
  sriQueue: SriQueue;
}

const VERSION = '1.0.0';

function parseId(value: unknown, name: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation(`'${name}' debe ser un entero positivo.`, [{ name, reason: 'Debe ser un entero positivo.' }]);
  return id;
}

/** Electronic Invoicing Service (contrato `Plan/ms_invoicing/ms_invoicing-openapi.yaml`): facturas electrónicas con el SRI simulado. */
export function createMsInvoicingService(config: MsInvoicingConfig, dataSource: DataSource, deps: MsInvoicingDependencies = {}): MsInvoicingService {
  const logger = deps.logger ?? createLogger('ms-invoicing');
  const esb = deps.esb ?? new EsbClient(config.esbUrl);
  const invoices = new InvoiceRepository(dataSource);
  const service = new InvoiceService(invoices, esb, config, logger);
  const serviceToken = requireServiceToken(config.serviceToken);

  /** Otro servicio con `X-Service-Token`, o un `ADMIN`. */
  const serviceOrAdmin: RequestHandler = async (req, res, next) => {
    if (req.get('x-service-token')) return serviceToken(req, res, next);
    if (!hasRole(await requirePrincipal(config.internalTokenSecret), 'ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
    next();
  };

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-invoicing', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  api.get('/facturas', serviceOrAdmin, async (req, res) => {
    const { estado, estado_sri: estadoSri } = req.query as Record<string, string | undefined>;
    if (estado && !(INVOICE_STATES as readonly string[]).includes(estado)) throw AppError.validation('Estado desconocido.', [{ name: 'estado', reason: `Debe ser ${INVOICE_STATES.join(', ')}.` }]);
    if (estadoSri && !(SRI_STATES as readonly string[]).includes(estadoSri)) throw AppError.validation('Estado SRI desconocido.', [{ name: 'estado_sri', reason: `Debe ser ${SRI_STATES.join(', ')}.` }]);
    const page = req.query.page === undefined ? 1 : parseId(req.query.page, 'page');
    const limit = req.query.limit === undefined ? 20 : parseId(req.query.limit, 'limit');
    if (limit > 100) throw AppError.validation("'limit' no puede superar 100.", [{ name: 'limit', reason: 'Máximo 100.' }]);
    const { total, items } = await invoices.list(estado ?? null, estadoSri ?? null, page, limit);
    res.json({ metadata: { total_results: total, page, limit, total_pages: Math.ceil(total / limit) }, data: items });
  });

  api.get('/facturas/orden/:ordId', serviceOrAdmin, async (req, res) => {
    const factura = await invoices.findByOrder(parseId(req.params.ordId, 'ord_id'));
    if (!factura) throw AppError.notFound(`La orden ${req.params.ordId} no tiene factura.`, 'INVOICE_NOT_FOUND');
    res.json(factura);
  });

  api.get('/facturas/:id', serviceOrAdmin, async (req, res) => {
    const factura = await invoices.findById(parseId(req.params.id, 'id'));
    if (!factura) throw AppError.notFound(`No existe la factura ${req.params.id}.`, 'INVOICE_NOT_FOUND');
    res.json(factura);
  });

  const app = createHttpService({
    service: 'ms-invoicing',
    logger,
    health: () => checkHealth('ms-invoicing', dataSource),
    routes: (express) => express.use(config.basePath, api),
  });
  return { app, onEvent: service.eventHandler(), sriQueue: new SriQueue(dataSource, invoices, esb, config.issuer, config.sriMaxPorMinuto, logger) };
}
