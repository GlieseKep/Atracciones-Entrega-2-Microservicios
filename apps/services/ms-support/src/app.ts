import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  hasRole,
  requirePrincipal,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { parseId, parseMessage, parseMessageQuery, parseRead } from './application/message-input';
import { SUPPORT_BASE_PATH } from './integration/esb-routes';
import { MessageRepository } from './persistence/message-repository';

export interface MsSupportConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  basePath: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsSupportConfig(env: NodeJS.ProcessEnv = process.env): MsSupportConfig {
  return {
    port: Number(env.PORT ?? 4017),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_support', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    basePath: env.BASE_PATH ?? SUPPORT_BASE_PATH,
    nodeId: env.NODE_ID ?? 'node-dilan-support-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_SUPPORT',
  };
}

export interface MsSupportDependencies {
  logger?: Logger;
}

const VERSION = '1.0.0';

/** Support Service (REST, contrato `Plan/ms_support/ms_support-openapi.yaml`): mensajes de contacto de los visitantes. */
export function createMsSupportService(config: MsSupportConfig, dataSource: DataSource, deps: MsSupportDependencies = {}): Express {
  const logger = deps.logger ?? createLogger('ms-support');
  const messages = new MessageRepository(dataSource);

  async function requireAdmin(): Promise<void> {
    if (!hasRole(await requirePrincipal(config.internalTokenSecret), 'ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
  }

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-support', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  api.post('/mensajes-contacto', async (req, res) => {
    res.status(201).json(await messages.create(parseMessage(req.body)));
  });

  api.get('/mensajes-contacto', async (req, res) => {
    await requireAdmin();
    const { leido, page, limit } = parseMessageQuery(req.query as Record<string, unknown>);
    const { total, items } = await messages.list(leido, page, limit);
    res.json({ data: items, pagination: { total_results: total, page, limit, total_pages: Math.ceil(total / limit) } });
  });

  api.put('/mensajes-contacto/:id/leido', async (req, res) => {
    await requireAdmin();
    const message = await messages.setRead(parseId(req.params.id), parseRead(req.body));
    if (!message) throw AppError.notFound(`No existe el mensaje ${req.params.id}.`, 'MESSAGE_NOT_FOUND');
    res.json(message);
  });

  return createHttpService({
    service: 'ms-support',
    logger,
    health: () => checkHealth('ms-support', dataSource),
    routes: (app) => app.use(config.basePath, api),
  });
}
