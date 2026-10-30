import {
  AppError,
  checkHealth,
  createHttpService,
  createLogger,
  currentCorrelationId,
  currentPrincipal,
  newCorrelationId,
  requireAdmin,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { parseMessage, parseMessageFilters, parseMessageId, parseStatus } from './application/message-input';
import { SUPPORT_BASE_PATH } from './integration/esb-routes';
import { MessageRepository, TooManyMessages, type RateLimit } from './persistence/message-repository';

export interface MsSupportConfig {
  port: number;
  database: DatabaseSettings;
  internalTokenSecret: string;
  /** Prefijo de las rutas del contrato (`servers[0].url`). */
  basePath: string;
  /** Mensajes por correo permitidos en la ventana del formulario público. */
  rateLimit: RateLimit;
}

export function readMsSupportConfig(env: NodeJS.ProcessEnv = process.env): MsSupportConfig {
  return {
    port: Number(env.PORT ?? 4017),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_support', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    basePath: env.BASE_PATH ?? SUPPORT_BASE_PATH,
    rateLimit: { max: Number(env.SUPPORT_MAX_MESSAGES_PER_HOUR ?? 5), windowSeconds: 3600 },
  };
}

export interface MsSupportDependencies {
  logger?: Logger;
}

export interface MsSupportService {
  app: Express;
  messages: MessageRepository;
}

const messageNotFound = () => AppError.notFound('El mensaje de contacto no existe.', 'CONTACT_MESSAGE_NOT_FOUND');

/**
 * Support Service (REST, contrato `Plan/ms_support/ms_support-openapi.yaml`): formulario de contacto del portal y su
 * seguimiento. Rutas, campos y estados iguales a los que tenía Audit, para que GraphQL solo cambie de servicio.
 */
export function createMsSupportService(config: MsSupportConfig, dataSource: DataSource, deps: MsSupportDependencies = {}): MsSupportService {
  const logger = deps.logger ?? createLogger('ms-support');
  const messages = new MessageRepository(dataSource);

  const api = Router();

  // Formulario público: con sesión se guarda también el usuario.
  api.post('/mensajes-contacto', async (req, res) => {
    const input = parseMessage(req.body);
    const principal = config.internalTokenSecret ? await currentPrincipal(config.internalTokenSecret) : null;
    try {
      const created = await messages.create(
        { ...input, userId: principal?.tipo === 'USUARIO' ? principal.id : null, correlationId: currentCorrelationId() ?? newCorrelationId() },
        config.rateLimit,
      );
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof TooManyMessages) {
        logger.warn('límite de mensajes de contacto alcanzado', { retry_after: error.retryAfter });
        res.set('Retry-After', String(error.retryAfter));
      }
      throw error;
    }
  });

  // Bandeja de soporte (rol ADMIN).
  api.get('/mensajes-contacto', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    res.json(await messages.list(parseMessageFilters(req.query as Record<string, unknown>)));
  });

  api.get('/mensajes-contacto/resumen', async (_req, res) => {
    await requireAdmin(config.internalTokenSecret);
    res.json(await messages.summary());
  });

  api.put('/mensajes-contacto/:id/estado', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const estado = parseStatus(req.body);
    const id = parseMessageId(String(req.params.id));
    if (id === null) throw messageNotFound();
    const updated = await messages.setStatus(id, estado);
    if (!updated) throw messageNotFound();
    res.json(updated);
  });

  const health = () => checkHealth('ms-support', dataSource);
  const app = createHttpService({
    service: 'ms-support',
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
  return { app, messages };
}
