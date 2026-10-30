import {
  AppError,
  checkHealth,
  createHttpService,
  createLogger,
  EsbClient,
  requireAdmin,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { esbPaymentLookup, type PaymentLookup } from './application/payments';
import { RefundFlow } from './application/refund-flow';
import { isUuid, parsePaymentIds, parseRefundFilters, parseRefundRequest } from './application/refund-input';
import { REFUND_BASE_PATH } from './integration/esb-routes';
import { simulatedRefundGateway, type RefundGateway } from './integration/payment-gateway';
import { RefundRepository } from './persistence/refund-repository';

export interface MsRefundConfig {
  port: number;
  database: DatabaseSettings;
  internalTokenSecret: string;
  esbUrl: string;
  /** Prefijo de las rutas del contrato (`servers[0].url`). */
  basePath: string;
}

export function readMsRefundConfig(env: NodeJS.ProcessEnv = process.env): MsRefundConfig {
  return {
    port: Number(env.PORT ?? 4016),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_refund', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    basePath: env.BASE_PATH ?? REFUND_BASE_PATH,
  };
}

export interface MsRefundDependencies {
  payments?: PaymentLookup;
  gateway?: RefundGateway;
  logger?: Logger;
}

export interface MsRefundService {
  app: Express;
  refunds: RefundRepository;
  flow: RefundFlow;
}

/**
 * Refund Service (REST, contrato `Plan/ms_refund/ms_refund-openapi.yaml`): reembolsos de pagos aprobados. `POST
 * /reembolsos` tiene la misma entrada y salida que tenía Payment, para que la saga de cancelación solo cambie de
 * servicio. Publica `refund.ReembolsoEmitido` (Invoicing emite la nota de crédito).
 *
 * Todas las rutas son internas: cuentas de servicio (Order, GraphQL) o el administrador.
 */
export function createMsRefundService(config: MsRefundConfig, dataSource: DataSource, deps: MsRefundDependencies = {}): MsRefundService {
  const logger = deps.logger ?? createLogger('ms-refund');
  const refunds = new RefundRepository(dataSource);
  const payments = deps.payments ?? esbPaymentLookup(new EsbClient(config.esbUrl), config.internalTokenSecret);
  const flow = new RefundFlow(dataSource, refunds, payments, deps.gateway ?? simulatedRefundGateway, logger);

  const api = Router();

  api.post('/reembolsos', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    res.status(201).json(await flow.refund(parseRefundRequest(req.body)));
  });

  api.get('/reembolsos', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    res.json(await refunds.list(parseRefundFilters(req.query as Record<string, unknown>)));
  });

  // Van antes de `/reembolsos/:codigo`.
  api.post('/reembolsos/pagos', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    res.json(await refunds.byPayments(parsePaymentIds(req.body)));
  });

  api.get('/reembolsos/orden/:orden_id', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const orderId = String(req.params.orden_id);
    res.json(isUuid(orderId) ? await refunds.byOrder(orderId.toLowerCase()) : []);
  });

  api.get('/reembolsos/:codigo', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const code = String(req.params.codigo).toUpperCase();
    const refund = await refunds.get(code);
    if (!refund) throw AppError.notFound(`No existe el reembolso ${code}.`, 'REFUND_NOT_FOUND');
    res.json(refund);
  });

  const health = () => checkHealth('ms-refund', dataSource);
  const app = createHttpService({
    service: 'ms-refund',
    logger,
    health,
    routes: (a) => {
      // `/health` lo agrega createHttpService; el contrato lo publica también bajo el prefijo.
      a.get(`${config.basePath}/health`, async (_req, res) => {
        const report = await health();
        res.status(report.status === 'UP' ? 200 : 503).json(report);
      });
      a.use(config.basePath, api);
    },
  });
  return { app, refunds, flow };
}
