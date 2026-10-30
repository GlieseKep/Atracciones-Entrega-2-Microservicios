import {
  AppError,
  BUSINESS_TIME_ZONE,
  checkHealth,
  createHttpService,
  createLogger,
  EsbClient,
  requireAdmin,
  requirePrincipal,
  requireScope,
  todayIn,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { mergeAgreement, parseAgreementUpdate, toAgreementResponse, type Agreement } from './application/agreement';
import { checkCouponRules, normalizeCode, parseCouponCreate, parseCouponFilters, parseCouponPatch, parseValidation } from './application/coupon-input';
import { evaluateCoupon } from './application/coupon-validation';
import { addYears } from './application/dates';
import { esbCityDirectory, namesFor, resolveNames, type CityDirectory } from './application/destinations';
import type { CouponDto, CouponPageDto, CouponValidationResponseDto } from './contract';
import { COUPON_BASE_PATH } from './integration/esb-routes';
import { AgreementRepository } from './persistence/agreement-repository';
import { CouponRepository } from './persistence/coupon-repository';

export interface MsCouponConfig {
  port: number;
  database: DatabaseSettings;
  internalTokenSecret: string;
  esbUrl: string;
  /** Prefijo de las rutas del contrato (`servers[0].url`). */
  basePath: string;
  /** `proveedor_id` del acuerdo con Booking. */
  providerCode: string;
  /** `nombre_comercial` con el que se crea el acuerdo si todavía no existe. */
  commercialName: string;
  timeZone: string;
}

export function readMsCouponConfig(env: NodeJS.ProcessEnv = process.env): MsCouponConfig {
  return {
    port: Number(env.PORT ?? 4011),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_coupon', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    basePath: env.BASE_PATH ?? COUPON_BASE_PATH,
    providerCode: env.COUPON_PROVIDER_ID ?? 'proveedor-atracciones-dilan',
    commercialName: env.COUPON_COMMERCIAL_NAME ?? 'Descubre EC',
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
  };
}

export interface MsCouponDependencies {
  cities?: CityDirectory;
  logger?: Logger;
  /** Reloj para "hoy" (vigencias); las pruebas lo fijan. */
  now?: () => Date;
}

export interface MsCouponService {
  app: Express;
  agreements: AgreementRepository;
  coupons: CouponRepository;
}

const couponNotFound = (code: string) => AppError.notFound(`No existe el cupón ${code}.`, 'COUPON_NOT_FOUND');

/**
 * Coupon & Promotions Service (REST, contrato `Plan/ms_coupon/ms_coupon-openapi.yaml`): el acuerdo B2B de promociones
 * con Booking (rutas y esquemas idénticos al contrato v3) y los cupones del portal.
 */
export function createMsCouponService(config: MsCouponConfig, dataSource: DataSource, deps: MsCouponDependencies = {}): MsCouponService {
  const logger = deps.logger ?? createLogger('ms-coupon');
  const agreements = new AgreementRepository(dataSource);
  const coupons = new CouponRepository(dataSource);
  const cities = deps.cities ?? esbCityDirectory(new EsbClient(config.esbUrl), logger);
  const today = () => todayIn(config.timeZone, (deps.now ?? (() => new Date()))());

  /** Nombres de los destinos guardados; sin destinos no se consulta el catálogo de ciudades. */
  const destinationNames = async (agreement: Agreement) => {
    if (!agreement.destinationIds.length) return [];
    const { names, unknown } = namesFor(agreement.destinationIds, await cities.cities());
    if (unknown.length) logger.warn('destinos del acuerdo que ya no existen en el catálogo de ciudades', { ciu_ids: unknown });
    return names;
  };

  const defaultAgreement = (date: string): Agreement => ({
    providerCode: config.providerCode,
    commercialName: config.commercialName,
    allowsPromotions: false,
    maxDiscount: 0,
    agreementDate: date,
    validUntil: addYears(date, 1),
    comboConditions: null,
    contact: { name: null, email: null, phone: null },
    destinationIds: [],
  });

  const api = Router();

  // Acuerdo B2B de promociones (contrato v3: 200 / 401 / 403 / 500 en GET; además 400 en PUT).
  api.get('/atracciones/promociones/contrato', async (_req, res) => {
    requireScope(await requirePrincipal(config.internalTokenSecret), 'promotions:read');
    const agreement = await agreements.get(config.providerCode);
    if (!agreement) throw AppError.internal('El acuerdo de promociones no está configurado.');
    res.json(toAgreementResponse(agreement, await destinationNames(agreement)));
  });

  api.put('/atracciones/promociones/contrato', async (req, res) => {
    requireScope(await requirePrincipal(config.internalTokenSecret), 'promotions:write');
    const update = parseAgreementUpdate(req.body);
    let destinationIds: number[] | undefined;
    if (update.destinations) {
      const { ids, missing } = resolveNames(update.destinations, await cities.cities());
      if (missing.length) {
        throw AppError.validation(
          `Destinos que no existen en el catálogo de ciudades: ${missing.join(', ')}.`,
          missing.map((name) => ({ name: 'destinos_habilitados', reason: `'${name}' no es una ciudad registrada.` })),
          'DESTINATION_NOT_FOUND',
        );
      }
      destinationIds = ids;
    }
    const date = today();
    const saved = await agreements.save(config.providerCode, async (current) => mergeAgreement(current ?? defaultAgreement(date), update, date, destinationIds));
    res.json(toAgreementResponse(saved, await destinationNames(saved)));
  });

  // Administración de cupones (rol ADMIN).
  api.get('/cupones', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const filters = parseCouponFilters(req.query as Record<string, unknown>);
    const { total, items } = await coupons.list(filters);
    const page: CouponPageDto = {
      metadata: { total_results: total, page: filters.page, limit: filters.limit, total_pages: Math.ceil(total / filters.limit), next_cursor: null },
      data: items,
    };
    res.json(page);
  });

  api.post('/cupones', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const created = await coupons.create(parseCouponCreate(req.body));
    res.status(201).location(`${config.basePath}/cupones/${created.code}`).json(created);
  });

  // Validación: cualquier principal autenticado (GraphQL en el checkout, Order al crear la orden).
  api.post('/cupones/validacion', async (req, res) => {
    await requirePrincipal(config.internalTokenSecret);
    const input = parseValidation(req.body);
    const coupon = await coupons.get(input.code);
    const result = evaluateCoupon(
      coupon && { code: coupon.code, type: coupon.type, value: coupon.value, startDate: coupon.start_date, endDate: coupon.end_date, maxUses: coupon.max_uses, active: coupon.active },
      input.subtotal,
      input.date ?? today(),
    );
    const body: CouponValidationResponseDto = {
      code: input.code,
      valid: result.valid,
      reason: result.reason,
      ...(coupon ? { type: coupon.type, value: coupon.value } : {}),
      discount_amount: result.discount,
      currency: input.currency,
      max_uses: coupon?.max_uses ?? null,
    };
    res.json(body);
  });

  api.get('/cupones/:code', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const code = normalizeCode(String(req.params.code));
    const coupon = await coupons.get(code);
    if (!coupon) throw couponNotFound(code);
    res.json(coupon);
  });

  api.patch('/cupones/:code', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const code = normalizeCode(String(req.params.code));
    const patch = parseCouponPatch(req.body);
    const updated = await coupons.update(code, patch, (merged: CouponDto) =>
      checkCouponRules({ type: merged.type, value: merged.value, startDate: merged.start_date, endDate: merged.end_date }));
    if (!updated) throw couponNotFound(code);
    res.json(updated);
  });

  const health = () => checkHealth('ms-coupon', dataSource);
  const app = createHttpService({
    service: 'ms-coupon',
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
  return { app, agreements, coupons };
}
