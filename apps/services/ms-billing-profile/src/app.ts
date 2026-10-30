import {
  AppError,
  checkHealth,
  createHttpService,
  createLogger,
  requireAdmin,
  requirePrincipal,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { toLegacy } from './application/legacy';
import { parseLegacy, parseProfile, parseProfileId } from './application/profile-input';
import { BILLING_PROFILE_BASE_PATH } from './integration/esb-routes';
import { ProfileRepository } from './persistence/profile-repository';

export interface MsBillingProfileConfig {
  port: number;
  database: DatabaseSettings;
  internalTokenSecret: string;
  /** Prefijo de las rutas del contrato (`servers[0].url`). */
  basePath: string;
}

export function readMsBillingProfileConfig(env: NodeJS.ProcessEnv = process.env): MsBillingProfileConfig {
  return {
    port: Number(env.PORT ?? 4013),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_billing_profile', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    basePath: env.BASE_PATH ?? BILLING_PROFILE_BASE_PATH,
  };
}

export interface MsBillingProfileDependencies {
  logger?: Logger;
}

export interface MsBillingProfileService {
  app: Express;
  profiles: ProfileRepository;
}

const profileNotFound = () => AppError.notFound('El perfil de facturación no existe.', 'BILLING_PROFILE_NOT_FOUND');

/**
 * Billing Profile Service (REST, contrato `Plan/ms_billing_profile/ms_billing_profile-openapi.yaml`): datos de
 * facturación de los usuarios del portal (varios por usuario, uno principal). `GET`/`PUT /usuarios/me/facturacion`
 * conservan la forma de la ruta de Identity para que el portal no cambie en el corte.
 */
export function createMsBillingProfileService(
  config: MsBillingProfileConfig,
  dataSource: DataSource,
  deps: MsBillingProfileDependencies = {},
): MsBillingProfileService {
  const logger = deps.logger ?? createLogger('ms-billing-profile');
  const profiles = new ProfileRepository(dataSource);

  /** `/usuarios/me/**`: solo un usuario del portal (un socio con X-API-Key no tiene datos de facturación aquí). */
  const me = async () => {
    const principal = await requirePrincipal(config.internalTokenSecret);
    if (principal.tipo !== 'USUARIO') throw AppError.forbidden('Los datos de facturación son de los usuarios del portal.');
    return principal.id;
  };

  /** ID de la ruta; uno inválido "no existe" (404, no 400). */
  const profileId = (raw: unknown) => {
    const id = parseProfileId(String(raw));
    if (id === null) throw profileNotFound();
    return id;
  };

  const api = Router();

  // Mis datos de facturación ---------------------------------------------------

  api.get('/usuarios/me/datos-facturacion', async (_req, res) => {
    res.json(await profiles.listMine(await me()));
  });

  api.post('/usuarios/me/datos-facturacion', async (req, res) => {
    const userId = await me();
    const created = await profiles.create(userId, parseProfile(req.body));
    res.status(201).location(`${config.basePath}/usuarios/me/datos-facturacion/${created.id}`).json(created);
  });

  api.put('/usuarios/me/datos-facturacion/:id', async (req, res) => {
    const userId = await me();
    const id = profileId(req.params.id);
    const updated = await profiles.replace(userId, id, parseProfile(req.body));
    if (!updated) throw profileNotFound();
    res.json(updated);
  });

  api.delete('/usuarios/me/datos-facturacion/:id', async (req, res) => {
    const userId = await me();
    if (!(await profiles.deactivate(userId, profileId(req.params.id)))) throw profileNotFound();
    res.status(204).end();
  });

  api.put('/usuarios/me/datos-facturacion/:id/principal', async (req, res) => {
    const userId = await me();
    const updated = await profiles.setPrincipal(userId, profileId(req.params.id));
    if (!updated) throw profileNotFound();
    res.json(updated);
  });

  // Compatibilidad con Identity (perfil principal) ------------------------------

  api.get('/usuarios/me/facturacion', async (_req, res) => {
    const principal = await profiles.principal(await me());
    res.json({ facturacion: principal ? toLegacy(principal) : null });
  });

  api.put('/usuarios/me/facturacion', async (req, res) => {
    const userId = await me();
    res.json(toLegacy(await profiles.saveLegacy(userId, parseLegacy(req.body))));
  });

  // Uso interno: Order e Invoicing con su cuenta de servicio, o el administrador.

  api.get('/datos-facturacion/:id', async (req, res) => {
    await requireAdmin(config.internalTokenSecret);
    const profile = await profiles.get(profileId(req.params.id));
    if (!profile) throw profileNotFound();
    res.json(profile);
  });

  const health = () => checkHealth('ms-billing-profile', dataSource);
  const app = createHttpService({
    service: 'ms-billing-profile',
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
  return { app, profiles };
}
