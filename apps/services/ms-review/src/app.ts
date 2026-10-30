import {
  AppError,
  checkHealth,
  createHttpService,
  createLogger,
  EsbClient,
  requireAdmin,
  requirePrincipal,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { esbAuthorDirectory, FALLBACK_AUTHOR, shortName, type AuthorDirectory } from './application/authors';
import { checkEligibility, esbReservationLookup, type ReservationLookup } from './application/eligibility';
import {
  parseAttractionId,
  parseListQuery,
  parseModerationQuery,
  parseReviewCreate,
  parseReviewId,
  parseVisibility,
} from './application/review-input';
import type { ModerationPageDto, PaginationMetadata, ReviewDto, ReviewPageDto } from './contract';
import { REVIEW_BASE_PATH } from './integration/esb-routes';
import { ReviewRepository, type ReviewRow } from './persistence/review-repository';
import { SummaryRepository } from './persistence/summary-repository';

export interface MsReviewConfig {
  port: number;
  database: DatabaseSettings;
  internalTokenSecret: string;
  esbUrl: string;
  /** Prefijo de las rutas del contrato (`servers[0].url`). */
  basePath: string;
}

export function readMsReviewConfig(env: NodeJS.ProcessEnv = process.env): MsReviewConfig {
  return {
    port: Number(env.PORT ?? 4015),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_review', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    basePath: env.BASE_PATH ?? REVIEW_BASE_PATH,
  };
}

export interface MsReviewDependencies {
  reservations?: ReservationLookup;
  authors?: AuthorDirectory;
  logger?: Logger;
}

export interface MsReviewService {
  app: Express;
  reviews: ReviewRepository;
  summaries: SummaryRepository;
}

const reviewNotFound = () => AppError.notFound('La reseña no existe.', 'REVIEW_NOT_FOUND');

const metadata = (total: number, page: number, limit: number): PaginationMetadata => ({
  total_results: total, page, limit, total_pages: Math.ceil(total / limit), next_cursor: null,
});

/**
 * Review Service (REST, contrato `Plan/ms_review/ms_review-openapi.yaml`): reseñas de las atracciones y su resumen.
 * Solo reseña quien tuvo una reserva propia de la atracción ya usada (se verifica con Booking). Cada cambio publica
 * `review.ResenaPublicada` con el resumen recalculado; Catalog lo muestra como `rating` del contrato v3.
 */
export function createMsReviewService(config: MsReviewConfig, dataSource: DataSource, deps: MsReviewDependencies = {}): MsReviewService {
  const logger = deps.logger ?? createLogger('ms-review');
  const esb = new EsbClient(config.esbUrl);
  const summaries = new SummaryRepository(dataSource);
  const reviews = new ReviewRepository(dataSource, summaries);
  const reservations = deps.reservations ?? esbReservationLookup(esb);
  const authors = deps.authors ?? esbAuthorDirectory(esb, config.internalTokenSecret, logger);

  /** Filas → `Review`, con el nombre del autor de Identity (o el de las reseñas anónimas). */
  async function toReviews(rows: ReviewRow[], withHiddenReason: boolean): Promise<ReviewDto[]> {
    const names = await authors.names(rows.flatMap((r) => (r.usu_id ? [r.usu_id] : [])));
    return rows.map((r) => {
      const fullName = r.usu_id ? names.get(r.usu_id) : r.autor_nombre;
      return {
        id: r.id,
        attraction_id: r.attraction_id,
        author_name: fullName ? shortName(fullName) : FALLBACK_AUTHOR,
        verified_purchase: r.verified_purchase,
        score: r.score,
        breakdown: { limpieza: r.limpieza, servicio: r.servicio, calidad_precio: r.calidad_precio, puntualidad: r.puntualidad },
        comment: r.comment,
        visible: r.visible,
        ...(withHiddenReason ? { hidden_reason: r.hidden_reason } : {}),
        created_at: r.created_at,
      };
    });
  }

  /** Publicar y "mis reseñas": solo un usuario del portal. */
  const user = async () => {
    const principal = await requirePrincipal(config.internalTokenSecret);
    if (principal.tipo !== 'USUARIO') throw AppError.forbidden('Solo los usuarios del portal pueden publicar reseñas.');
    return principal;
  };

  const api = Router();

  // Reseñas de una atracción (lectura pública) -------------------------------------

  api.get('/atracciones/:attraction_id/resenas', async (req, res) => {
    const attractionId = parseAttractionId(String(req.params.attraction_id));
    const filters = parseListQuery(req.query as Record<string, unknown>);
    const [summary, { total, items }] = await Promise.all([summaries.get(attractionId), reviews.listVisible(attractionId, filters)]);
    const page: ReviewPageDto = { summary, metadata: metadata(total, filters.page, filters.limit), data: await toReviews(items, false) };
    res.json(page);
  });

  api.get('/atracciones/:attraction_id/calificacion', async (req, res) => {
    res.json(await summaries.get(parseAttractionId(String(req.params.attraction_id))));
  });

  api.post('/atracciones/:attraction_id/resenas', async (req, res) => {
    const principal = await user();
    const attractionId = parseAttractionId(String(req.params.attraction_id));
    const input = parseReviewCreate(req.body);
    const reservationId = await checkEligibility(reservations, input.reservationId, attractionId, principal);
    const { review, summary } = await reviews.create(attractionId, principal.id, reservationId, input);
    logger.info('reseña publicada', { ren_id: review.id, atraccion: attractionId, puntuacion: review.score, total: summary.review_count });
    const [dto] = await toReviews([review], false);
    res.status(201).json(dto);
  });

  // Mis reseñas ------------------------------------------------------------------------

  api.get('/usuarios/me/resenas', async (_req, res) => {
    const principal = await user();
    res.json(await toReviews(await reviews.listMine(principal.id), true));
  });

  // Moderación (rol ADMIN) -------------------------------------------------------------

  api.get('/resenas', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const filters = parseModerationQuery(req.query as Record<string, unknown>);
    const { total, items } = await reviews.listForModeration(filters);
    const page: ModerationPageDto = { metadata: metadata(total, filters.page, filters.limit), data: await toReviews(items, true) };
    res.json(page);
  });

  api.put('/resenas/:id/visibilidad', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const id = parseReviewId(String(req.params.id));
    if (id === null) throw reviewNotFound();
    const updated = await reviews.setVisibility(id, parseVisibility(req.body));
    if (!updated) throw reviewNotFound();
    logger.info('visibilidad de reseña cambiada', { ren_id: id, visible: updated.visible });
    const [dto] = await toReviews([updated], true);
    res.json(dto);
  });

  const health = () => checkHealth('ms-review', dataSource);
  const app = createHttpService({
    service: 'ms-review',
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
  return { app, reviews, summaries };
}
