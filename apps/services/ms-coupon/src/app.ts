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
  todayIn,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express, type RequestHandler } from 'express';
import type { DataSource } from 'typeorm';
import { AgreementService, parseAgreement } from './application/agreement';
import { assertDates, parseCouponCreate, parseCouponPatch, parseCouponQuery, parseValidation } from './application/coupon-input';
import { validateCoupon } from './application/coupon-validation';
import { COUPON_BASE_PATH } from './integration/esb-routes';
import { AgreementRepository } from './persistence/agreement-repository';
import { CouponRepository } from './persistence/coupon-repository';

export interface MsCouponConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Cabecera `X-Service-Token`, con la que Order valida cupones. */
  serviceToken: string;
  basePath: string;
  esbUrl: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsCouponConfig(env: NodeJS.ProcessEnv = process.env): MsCouponConfig {
  return {
    port: Number(env.PORT ?? 4011),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_coupon', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    basePath: env.BASE_PATH ?? COUPON_BASE_PATH,
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    nodeId: env.NODE_ID ?? 'node-dilan-coupon-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_COUPON',
  };
}

export interface MsCouponDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

const VERSION = '1.0.0';

/**
 * Coupon & Promotions Service (REST, contrato `Plan/ms_coupon/ms_coupon-openapi.yaml`): cupones del portal y acuerdo de
 * promociones con Booking Prototipo.
 */
export function createMsCouponService(config: MsCouponConfig, dataSource: DataSource, deps: MsCouponDependencies = {}): Express {
  const logger = deps.logger ?? createLogger('ms-coupon');
  const coupons = new CouponRepository(dataSource);
  const agreement = new AgreementService(new AgreementRepository(dataSource), deps.esb ?? new EsbClient(config.esbUrl), logger);
  const serviceToken = requireServiceToken(config.serviceToken);

  async function requireAdmin(): Promise<void> {
    if (!hasRole(await requirePrincipal(config.internalTokenSecret), 'ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
  }

  /** El acuerdo es de Booking Prototipo (`X-API-Key`) o de un `ADMIN`. */
  async function requirePartnerOrAdmin(): Promise<void> {
    const principal = await requirePrincipal(config.internalTokenSecret);
    if (principal.tipo !== 'API_CLIENTE' && !hasRole(principal, 'ADMIN')) {
      throw AppError.forbidden('Esta operación requiere credenciales de socio o el rol ADMIN.');
    }
  }

  /** La validación la usan el portal, con usuario, y Order, con `X-Service-Token`. */
  const userOrService: RequestHandler = async (req, res, next) => {
    if (req.get('x-service-token')) return serviceToken(req, res, next);
    await requirePrincipal(config.internalTokenSecret);
    next();
  };

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-coupon', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  // Acuerdo B2B (contrato v3) ---------------------------------------------------

  api.get('/atracciones/promociones/contrato', async (_req, res) => {
    await requirePartnerOrAdmin();
    res.json(await agreement.get());
  });

  api.put('/atracciones/promociones/contrato', async (req, res) => {
    await requirePartnerOrAdmin();
    res.json(await agreement.update(parseAgreement(req.body)));
  });

  // Cupones ---------------------------------------------------------------------

  api.post('/cupones/validacion', userOrService, async (req, res) => {
    const request = parseValidation(req.body);
    res.json(validateCoupon(request, await coupons.find(request.code), todayIn()));
  });

  api.get('/cupones', async (req, res) => {
    await requireAdmin();
    const { active, code, page, limit } = parseCouponQuery(req.query as Record<string, unknown>);
    const { total, items } = await coupons.list({ active, code }, page, limit);
    res.json({ metadata: { total_results: total, page, limit, total_pages: Math.ceil(total / limit) }, data: items });
  });

  api.post('/cupones', async (req, res) => {
    await requireAdmin();
    const coupon = await coupons.create(parseCouponCreate(req.body));
    res.status(201).location(`${config.basePath}/cupones/${coupon.code}`).json(coupon);
  });

  async function requireCoupon(code: string) {
    const found = await coupons.find(code.toUpperCase());
    if (!found) throw AppError.notFound(`No existe el cupón ${code}.`, 'COUPON_NOT_FOUND');
    return found.coupon;
  }

  api.get('/cupones/:code', async (req, res) => {
    await requireAdmin();
    res.json(await requireCoupon(req.params.code));
  });

  api.patch('/cupones/:code', async (req, res) => {
    await requireAdmin();
    const current = await requireCoupon(req.params.code);
    const patch = parseCouponPatch(req.body);
    assertDates(patch.start_date ?? current.start_date, patch.end_date === undefined ? current.end_date : patch.end_date);
    await coupons.update(current.code, patch);
    res.json(await requireCoupon(current.code));
  });

  return createHttpService({
    service: 'ms-coupon',
    logger,
    health: () => checkHealth('ms-coupon', dataSource),
    routes: (app) => app.use(config.basePath, api),
  });
}
