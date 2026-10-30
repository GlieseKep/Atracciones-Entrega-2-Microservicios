import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  EsbClient,
  hasRole,
  requirePrincipal,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { parseAnonymousReview, parseId, parsePaging, parseReview, parseVisible, parseVisibleFilter } from './application/review-input';
import { ReviewService } from './application/review-service';
import { REVIEW_BASE_PATH } from './integration/esb-routes';
import { ReviewRepository } from './persistence/review-repository';

export interface MsReviewConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  basePath: string;
  esbUrl: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsReviewConfig(env: NodeJS.ProcessEnv = process.env): MsReviewConfig {
  return {
    port: Number(env.PORT ?? 4015),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_review', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    basePath: env.BASE_PATH ?? REVIEW_BASE_PATH,
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    nodeId: env.NODE_ID ?? 'node-dilan-review-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_REVIEW',
  };
}

export interface MsReviewDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

const VERSION = '1.0.0';

/** Review Service (REST, contrato `Plan/ms_review/ms_review-openapi.yaml`): reseñas, moderación y promedios para Catalog. */
export function createMsReviewService(config: MsReviewConfig, dataSource: DataSource, deps: MsReviewDependencies = {}): Express {
  const logger = deps.logger ?? createLogger('ms-review');
  const repository = new ReviewRepository(dataSource);
  const reviews = new ReviewService(repository, deps.esb ?? new EsbClient(config.esbUrl), logger);

  /** `usu_id` sale siempre del token, nunca del cuerpo. */
  async function currentUser(): Promise<number> {
    const principal = await requirePrincipal(config.internalTokenSecret);
    const usuId = Number(principal.id);
    if (principal.tipo !== 'USUARIO' || !Number.isSafeInteger(usuId)) throw AppError.forbidden('Esta operación es solo para usuarios.');
    return usuId;
  }

  async function requireAdmin(): Promise<void> {
    if (!hasRole(await requirePrincipal(config.internalTokenSecret), 'ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
  }

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-review', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  api.get('/atracciones/:id/resenas', async (req, res) => {
    const { page, limit } = parsePaging(req.query as Record<string, unknown>);
    const atrId = await reviews.attractionId(req.params.id);
    res.json(await reviews.list({ atrId, usuId: null, visible: true }, page, limit));
  });

  api.post('/atracciones/:id/resenas', async (req, res) => {
    const usuId = await currentUser();
    res.status(201).json(await reviews.createForUser(req.params.id, usuId, parseReview(req.body)));
  });

  api.post('/atracciones/:id/resenas/anonimas', async (req, res) => {
    const { autorNombre, review } = parseAnonymousReview(req.body);
    res.status(201).json(await reviews.createAnonymous(req.params.id, autorNombre, review));
  });

  api.get('/usuarios/me/resenas', async (req, res) => {
    const usuId = await currentUser();
    const { page, limit } = parsePaging(req.query as Record<string, unknown>);
    res.json(await reviews.list({ atrId: null, usuId, visible: null }, page, limit));
  });

  api.put('/usuarios/me/resenas/:id', async (req, res) => {
    const usuId = await currentUser();
    res.json(await reviews.present(await repository.updateOwn(parseId(req.params.id), usuId, parseReview(req.body))));
  });

  api.get('/admin/resenas', async (req, res) => {
    await requireAdmin();
    const query = req.query as Record<string, unknown>;
    const { page, limit } = parsePaging(query);
    const atrId = query.atr_id === undefined ? null : parseId(query.atr_id, 'atr_id');
    res.json(await reviews.list({ atrId, usuId: null, visible: parseVisibleFilter(query.visible) }, page, limit));
  });

  api.put('/admin/resenas/:id/visibilidad', async (req, res) => {
    await requireAdmin();
    res.json(await reviews.present(await repository.setVisible(parseId(req.params.id), parseVisible(req.body))));
  });

  return createHttpService({
    service: 'ms-review',
    logger,
    health: () => checkHealth('ms-review', dataSource),
    routes: (app) => app.use(config.basePath, api),
  });
}
