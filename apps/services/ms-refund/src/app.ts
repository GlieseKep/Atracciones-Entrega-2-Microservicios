import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  currentContext,
  EsbClient,
  hasRole,
  requirePrincipal,
  requireServiceToken,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express, type RequestHandler } from 'express';
import type { DataSource } from 'typeorm';
import { parseIdempotencyKey, parseRefund, parseRefundQuery } from './application/refund-input';
import { RefundService } from './application/refund-service';
import { REFUND_BASE_PATH } from './integration/esb-routes';
import { RefundRepository } from './persistence/refund-repository';

export interface MsRefundConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Cabecera `X-Service-Token`, con la que llama Booking. */
  serviceToken: string;
  basePath: string;
  esbUrl: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsRefundConfig(env: NodeJS.ProcessEnv = process.env): MsRefundConfig {
  return {
    port: Number(env.PORT ?? 4016),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_refund', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    basePath: env.BASE_PATH ?? REFUND_BASE_PATH,
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    nodeId: env.NODE_ID ?? 'node-dilan-refund-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_REFUND',
  };
}

export interface MsRefundDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

const VERSION = '1.0.0';

/** Refund Service (REST, contrato `Plan/ms_refund/ms_refund-openapi.yaml`): reembolsos sin superar lo cobrado. */
export function createMsRefundService(config: MsRefundConfig, dataSource: DataSource, deps: MsRefundDependencies = {}): Express {
  const logger = deps.logger ?? createLogger('ms-refund');
  const refunds = new RefundRepository(dataSource);
  const service = new RefundService(refunds, deps.esb ?? new EsbClient(config.esbUrl));
  const serviceToken = requireServiceToken(config.serviceToken);

  /** Booking con `X-Service-Token`, o un `ADMIN`. El cliente ve su reembolso en la reserva. */
  const serviceOrAdmin: RequestHandler = async (req, res, next) => {
    if (req.get('x-service-token')) return serviceToken(req, res, next);
    if (!hasRole(await requirePrincipal(config.internalTokenSecret), 'ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
    next();
  };

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-refund', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  api.post('/reembolsos', serviceOrAdmin, async (req, res) => {
    const clave = parseIdempotencyKey(currentContext()?.idempotencyKey);
    const { refund, created } = await service.emit(parseRefund(req.body), clave);
    res.status(created ? 201 : 200).json(refund);
  });

  api.get('/reembolsos', serviceOrAdmin, async (req, res) => {
    const { pagId, page, limit } = parseRefundQuery(req.query as Record<string, unknown>);
    const { total, items } = await refunds.list(pagId, page, limit);
    res.json({ data: items, pagination: { total_results: total, page, limit, total_pages: Math.ceil(total / limit) } });
  });

  api.get('/reembolsos/:numero', serviceOrAdmin, async (req, res) => {
    const refund = await refunds.findByNumber(req.params.numero as string);
    if (!refund) throw AppError.notFound(`No existe el reembolso ${req.params.numero}.`, 'REFUND_NOT_FOUND');
    res.json(refund);
  });

  return createHttpService({
    service: 'ms-refund',
    logger,
    health: () => checkHealth('ms-refund', dataSource),
    routes: (app) => app.use(config.basePath, api),
  });
}
