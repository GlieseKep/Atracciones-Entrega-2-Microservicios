import * as OpenApiValidator from 'express-openapi-validator';
import express, { Router, type Express, type RequestHandler } from 'express';
import {
  AppError,
  createCache,
  createLogger,
  type Cache,
  EsbClient,
  openApiContractPath,
  requestContext,
  verifyInternalPrincipal,
  type EventBus,
} from '@atracciones/platform';
import { ContractStatuses } from './contract';
import type { PartnerApiConfig } from './config';
import { contractErrorHandler } from './errors';
import { NodeHealth } from './health';
import type { ContractRequest } from './request';
import { registerRoutes } from './routes';

/** Prefijo del contrato (`servers[0].url`). */
export const BASE_PATHS = ['/api/v3'] as const;

export type { ContractRequest } from './request';

/** Lee el principal interno firmado por el Gateway; sin él, la petición es anónima. */
function principalMiddleware(secret: string): RequestHandler {
  return async (req, _res, next) => {
    const token = req.headers['x-internal-principal'];
    (req as ContractRequest).principal = typeof token === 'string' && token ? await verifyInternalPrincipal(token, secret) : null;
    next();
  };
}

export interface PartnerApi {
  app: Express;
  esb: EsbClient;
  cache: Cache;
  /** Invalida el read model del catálogo cuando cambia una atracción, el acuerdo de promociones o una tarifa. */
  invalidateOn(bus: EventBus): Promise<void>;
}

/** Partner API: implementa `atracciones-openapi-v3.yaml` para Booking Prototipo. */
export function createPartnerApi(config: PartnerApiConfig): PartnerApi {
  const logger = createLogger('partner-api');
  const esb = new EsbClient(config.esbUrl);
  const cache = createCache(config.redisUrl);
  const statuses = ContractStatuses.load();
  const nodeHealth = new NodeHealth(esb, config);
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'extended');
  app.use(requestContext(logger));
  app.use(express.json({ limit: '256kb' }));
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') (req as ContractRequest).sentBody = structuredClone(req.body);
    next();
  });

  // Salud interna del proceso (orquestador de contenedores); la del contrato es GET /api/v3/atracciones/health.
  app.get('/health', (_req, res) => {
    res.json({ status: 'UP', service: 'partner-api' });
  });

  // La ficha de registro de Booking usa `/api/v3/health`, que no está en el contrato: responde lo mismo que la del nodo.
  app.get('/api/v3/health', async (_req, res) => {
    const report = await nodeHealth.report();
    res.status(report.status === 'DOWN' ? 503 : 200).json(report);
  });

  app.use(principalMiddleware(config.internalTokenSecret));
  // GET /eventos no documenta 400: un `limit` mayor que el máximo del contrato (200) se acota en vez de rechazarse.
  app.use(/^\/api\/v3\/atracciones\/eventos$/, (req, _res, next) => {
    const limit = Number(req.query.limit);
    if (Number.isInteger(limit) && limit > 200) Object.defineProperty(req, 'query', { value: { ...req.query, limit: '200' }, writable: true, configurable: true });
    next();
  });
  app.use(
    OpenApiValidator.middleware({
      apiSpec: openApiContractPath(),
      validateRequests: { allowUnknownQueryParameters: false },
      validateResponses: config.validateResponses,
      validateFormats: true,
      ajvFormats: { mode: 'full' },
      validateSecurity: {
        handlers: {
          // El Gateway ya verificó la credencial; aquí se exige que la operación la tenga (security del contrato).
          BearerAuth: (req) => (req as ContractRequest).principal?.tipo === 'USUARIO',
          ApiKeyAuth: (req) => (req as ContractRequest).principal?.tipo === 'API_CLIENTE',
        },
      },
    }),
  );

  const router = Router();
  registerRoutes(router, { esb, cache, statuses, config, nodeHealth, logger });
  for (const base of BASE_PATHS) app.use(base, router);

  app.use((req, _res, next) => next(AppError.notFound(`No existe la ruta ${req.method} ${req.path} en el contrato.`)));
  app.use(contractErrorHandler(statuses, logger));
  return {
    app,
    esb,
    cache,
    invalidateOn: (bus) =>
      bus.subscribe('partner-api.cache', ['catalog.*', 'pricing.*', 'review.*'], async () => {
        await cache.deletePrefix('detalle:');
        await cache.deletePrefix('categorias');
      }),
  };
}
