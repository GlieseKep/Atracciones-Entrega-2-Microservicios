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
  type EventBus,
  type EventHandler,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express, type RequestHandler } from 'express';
import type { DataSource } from 'typeorm';
import { parseId, parsePayment, parsePaymentQuery, parseTransfer, parseVerification, parseWebhook } from './application/input';
import { PaymentService } from './application/payment-service';
import { TransferService } from './application/transfer-service';
import { assertSignature, enqueueWebhook, webhookHandler } from './application/webhook-processor';
import type { PaymentGateway } from './integration/gateways/gateway';
import { SimulatedGateway } from './integration/gateways/simulated-gateway';
import { PAYMENT_BASE_PATH } from './integration/esb-routes';
import { PaymentRepository } from './persistence/payment-repository';

export interface MsPaymentConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Cabecera `X-Service-Token` de las rutas de otros servicios. */
  serviceToken: string;
  /** Firma HMAC del webhook. */
  webhookSecret: string;
  /** URL con la que la pasarela simulada llama al webhook. */
  webhookUrl: string;
  basePath: string;
  esbUrl: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsPaymentConfig(env: NodeJS.ProcessEnv = process.env): MsPaymentConfig {
  const port = Number(env.PORT ?? 4020);
  const basePath = env.BASE_PATH ?? PAYMENT_BASE_PATH;
  return {
    port,
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_payment', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    webhookSecret: env.WEBHOOK_SECRET ?? '',
    webhookUrl: env.PAYMENT_WEBHOOK_URL ?? `http://127.0.0.1:${port}${basePath}/webhooks/simulada`,
    basePath,
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    nodeId: env.NODE_ID ?? 'node-dilan-payment-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_PAYMENT',
  };
}

export interface MsPaymentDependencies {
  bus: EventBus;
  logger?: Logger;
  esb?: EsbClient;
  gateway?: PaymentGateway;
}

export interface MsPaymentService {
  app: Express;
  /** Consumidor de la cola de webhooks. */
  onWebhook: EventHandler;
}

const VERSION = '1.0.0';

/** Payment Service (REST, contrato `Plan/ms_payment/ms_payment-openapi.yaml`): pagos con pasarela simulada. */
export function createMsPaymentService(config: MsPaymentConfig, dataSource: DataSource, deps: MsPaymentDependencies): MsPaymentService {
  const logger = deps.logger ?? createLogger('ms-payment');
  const payments = new PaymentRepository(dataSource);
  const gateway = deps.gateway ?? new SimulatedGateway(config.webhookUrl, config.webhookSecret, logger);
  const service = new PaymentService(payments, gateway, logger);
  const transfers = new TransferService(payments, service, deps.esb ?? new EsbClient(config.esbUrl));
  const internal = requireServiceToken(config.serviceToken);

  async function requireAdmin(): Promise<void> {
    if (!hasRole(await requirePrincipal(config.internalTokenSecret), 'ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
  }

  /** Otro servicio con `X-Service-Token`, o un `ADMIN`. */
  const serviceOrAdmin: RequestHandler = async (req, res, next) => {
    if (req.get('x-service-token')) return internal(req, res, next);
    await requireAdmin();
    next();
  };

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-payment', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  api.get('/metodos-pago', async (_req, res) => {
    res.json(await payments.listMethods());
  });

  api.post('/pagos', internal, async (req, res) => {
    const { payment, created } = await service.register(parsePayment(req.body));
    res.status(created ? 201 : 200).json(payment);
  });

  api.get('/pagos', async (req, res) => {
    await requireAdmin();
    const { estado, metodo, page, limit } = parsePaymentQuery(req.query as Record<string, unknown>);
    const { total, items } = await payments.list({ estado, metodo }, page, limit);
    res.json({ metadata: { total_results: total, page, limit, total_pages: Math.ceil(total / limit) }, data: items });
  });

  api.get('/pagos/orden/:ordId', internal, async (req, res) => {
    res.json(await payments.listByOrder(parseId(req.params.ordId, 'ord_id')));
  });

  api.get('/pagos/:id', serviceOrAdmin, async (req, res) => {
    res.json(await service.get(parseId(req.params.id)));
  });

  api.post('/pagos/:id/cancelacion', internal, async (req, res) => {
    res.json(await service.cancel(parseId(req.params.id)));
  });

  api.post('/pagos/:id/transferencia', async (req, res) => {
    const principal = await requirePrincipal(config.internalTokenSecret);
    res.json(await transfers.submit(parseId(req.params.id), parseTransfer(req.body), principal));
  });

  api.put('/pagos/:id/verificacion', async (req, res) => {
    await requireAdmin();
    const { aprobado, motivo } = parseVerification(req.body);
    res.json(await transfers.verify(parseId(req.params.id), aprobado, motivo));
  });

  api.post('/webhooks/:pasarela', async (req, res) => {
    if (req.params.pasarela !== 'simulada') throw AppError.validation(`La pasarela ${req.params.pasarela} no existe.`, [{ name: 'pasarela', reason: 'Debe ser simulada.' }]);
    assertSignature(req.body, req.get('x-signature'), config.webhookSecret);
    await enqueueWebhook(deps.bus, parseWebhook(req.body));
    res.status(202).end();
  });

  const app = createHttpService({
    service: 'ms-payment',
    logger,
    health: () => checkHealth('ms-payment', dataSource),
    routes: (express) => express.use(config.basePath, api),
  });
  return { app, onWebhook: webhookHandler(payments, service, logger) };
}
