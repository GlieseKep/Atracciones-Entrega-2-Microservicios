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
import { clientRoutes } from './handlers/clients';
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

/** Campos de `CreateReservaRequestV3` que el contrato exige en inglés y que también llegan con su alias en español. */
const RESERVATION_ALIASES = [
  ['attraction_id', 'atraccion_id'],
  ['date', 'fecha'],
  ['time', 'hora'],
] as const;

/**
 * Acepta `atraccion_id`, `fecha` y `hora` en lugar de su nombre en inglés: el validador del contrato exige el campo en
 * inglés, así que se copia el alias antes de validar. Si llegan ambos con valores distintos, responde 422.
 */
const reservationAliases: RequestHandler = (req, _res, next) => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return next();
  const conflicts = RESERVATION_ALIASES.filter(([en, es]) => body[en] !== undefined && body[es] !== undefined && body[en] !== body[es]);
  if (conflicts.length > 0) {
    return next(AppError.unprocessable('ALIAS_CONFLICT', 'Un campo y su alias en español tienen valores distintos.',
      conflicts.map(([en, es]) => ({ name: es, reason: `Debe ser igual a ${en}.` }))));
  }
  const sent = (req as ContractRequest).sentBody;
  for (const [en, es] of RESERVATION_ALIASES) {
    if (body[en] !== undefined || body[es] === undefined) continue;
    body[en] = body[es];
    if (sent) sent[en] = body[es];
  }
  next();
};

export interface PartnerApi {
  app: Express;
  esb: EsbClient;
  cache: Cache;
  nodeHealth: NodeHealth;
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
  // La guía de socios de Booking reserva en `${baseUrlRest}/reservas`; el contrato, en `/atracciones/reservas`. Se aceptan las dos.
  app.post('/api/v3/reservas', (req, _res, next) => {
    req.url = req.url.replace('/api/v3/reservas', '/api/v3/atracciones/reservas');
    next();
  });
  app.post('/api/v3/reservas/:id/cancel', (req, _res, next) => {
    req.url = req.url.replace('/api/v3/reservas/', '/api/v3/atracciones/reservas/');
    next();
  });
  // Módulo de clientes pedido por Booking: no está en el contrato v3, así que va antes de su validador.
  for (const base of BASE_PATHS) app.use(base, clientRoutes(esb, logger));
  // GET /eventos no documenta 400: un `limit` mayor que el máximo del contrato (200) se acota en vez de rechazarse.
  app.use(/^\/api\/v3\/atracciones\/eventos$/, (req, _res, next) => {
    const limit = Number(req.query.limit);
    if (Number.isInteger(limit) && limit > 200) Object.defineProperty(req, 'query', { value: { ...req.query, limit: '200' }, writable: true, configurable: true });
    next();
  });
  app.post('/api/v3/atracciones/reservas', reservationAliases);
  // Disponibilidad: el contrato v3 pide `?date=`; también se acepta `?fecha=` (alias del contrato v2).
  app.get('/api/v3/atracciones/:id/disponibilidad', (req, _res, next) => {
    const { fecha, ...query } = req.query;
    if (fecha === undefined) return next();
    if (query.date !== undefined && query.date !== fecha) {
      return next(AppError.unprocessable('ALIAS_CONFLICT', 'date y fecha tienen valores distintos.', [{ name: 'fecha', reason: 'Debe ser igual a date.' }]));
    }
    Object.defineProperty(req, 'query', { value: { ...query, date: query.date ?? fecha }, writable: true, configurable: true });
    next();
  });
  app.use(
    OpenApiValidator.middleware({
      apiSpec: openApiContractPath(),
      // Por defecto busca la operación en `originalUrl`, que no ve el alias de /api/v3/reservas.
      useRequestUrl: true,
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
    nodeHealth,
    invalidateOn: (bus) =>
      bus.subscribe('partner-api.cache', ['catalog.*', 'pricing.*', 'review.*'], async () => {
        await cache.deletePrefix('detalle:');
        await cache.deletePrefix('categorias');
      }),
  };
}
