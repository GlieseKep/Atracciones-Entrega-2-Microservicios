import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  hasRole,
  requirePrincipal,
  type DatabaseSettings,
  type EventHandler,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { eventRecorder } from './application/event-recorder';
import { parseFilters } from './application/input';
import { AUDIT_BASE_PATH } from './integration/esb-routes';
import { AuditRepository } from './persistence/audit-repository';

export interface MsAuditConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  basePath: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsAuditConfig(env: NodeJS.ProcessEnv = process.env): MsAuditConfig {
  return {
    port: Number(env.PORT ?? 4022),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_audit', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    basePath: env.BASE_PATH ?? AUDIT_BASE_PATH,
    nodeId: env.NODE_ID ?? 'node-dilan-audit-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_AUDIT',
  };
}

export interface MsAuditDependencies {
  logger?: Logger;
}

export interface MsAuditService {
  app: Express;
  onEvent: EventHandler;
}

const VERSION = '1.0.0';

/** Audit Service (contrato `Plan/ms_audit/ms_audit-openapi.yaml`): bitácora de todos los eventos del bus. No tiene rutas de escritura. */
export function createMsAuditService(config: MsAuditConfig, dataSource: DataSource, deps: MsAuditDependencies = {}): MsAuditService {
  const logger = deps.logger ?? createLogger('ms-audit');
  const audit = new AuditRepository(dataSource);

  async function requireAdmin(): Promise<void> {
    if (!hasRole(await requirePrincipal(config.internalTokenSecret), 'ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
  }

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-audit', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  api.get('/bitacora', async (req, res) => {
    await requireAdmin();
    const filters = parseFilters(req.query as Record<string, unknown>);
    const { total, items } = await audit.list(filters);
    res.json({ metadata: { total_results: total, page: filters.page, limit: filters.limit, total_pages: Math.ceil(total / filters.limit) }, data: items });
  });

  api.get('/bitacora/acciones', async (_req, res) => {
    await requireAdmin();
    res.json(await audit.actions());
  });

  const app = createHttpService({
    service: 'ms-audit',
    logger,
    health: () => checkHealth('ms-audit', dataSource),
    routes: (express) => express.use(config.basePath, api),
  });
  return { app, onEvent: eventRecorder(audit, logger) };
}
