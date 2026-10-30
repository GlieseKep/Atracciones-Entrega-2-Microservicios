import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  requirePrincipal,
  requireServiceToken,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { parseId, parseProfile } from './application/profile-input';
import { BILLING_BASE_PATH } from './integration/esb-routes';
import { ProfileRepository } from './persistence/profile-repository';

export interface MsBillingProfileConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Cabecera `X-Service-Token` de las rutas `/internal/**`. */
  serviceToken: string;
  basePath: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsBillingProfileConfig(env: NodeJS.ProcessEnv = process.env): MsBillingProfileConfig {
  return {
    port: Number(env.PORT ?? 4013),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_billing_profile', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    basePath: env.BASE_PATH ?? BILLING_BASE_PATH,
    nodeId: env.NODE_ID ?? 'node-dilan-billing-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_BILLING',
  };
}

export interface MsBillingProfileDependencies {
  logger?: Logger;
}

const VERSION = '1.0.0';

/**
 * Billing Profile Service (REST, contrato `Plan/ms_billing_profile/ms_billing_profile-openapi.yaml`): perfiles de
 * facturación de cada usuario. Invoicing lee el principal para la factura.
 */
export function createMsBillingProfileService(config: MsBillingProfileConfig, dataSource: DataSource, deps: MsBillingProfileDependencies = {}): Express {
  const logger = deps.logger ?? createLogger('ms-billing-profile');
  const profiles = new ProfileRepository(dataSource);

  /** `usu_id` sale siempre del token, nunca del cuerpo. */
  async function currentUser(): Promise<number> {
    const principal = await requirePrincipal(config.internalTokenSecret);
    const usuId = Number(principal.id);
    if (principal.tipo !== 'USUARIO' || !Number.isSafeInteger(usuId)) throw AppError.forbidden('Esta operación es solo para usuarios.');
    return usuId;
  }

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-billing-profile', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  api.get('/usuarios/me/datos-facturacion', async (_req, res) => {
    res.json(await profiles.list(await currentUser()));
  });

  api.post('/usuarios/me/datos-facturacion', async (req, res) => {
    const usuId = await currentUser();
    res.status(201).json(await profiles.create(usuId, parseProfile(req.body)));
  });

  api.put('/usuarios/me/datos-facturacion/:id', async (req, res) => {
    const usuId = await currentUser();
    res.json(await profiles.replace(usuId, parseId(req.params.id), parseProfile(req.body)));
  });

  api.delete('/usuarios/me/datos-facturacion/:id', async (req, res) => {
    const usuId = await currentUser();
    await profiles.deactivate(usuId, parseId(req.params.id));
    res.status(204).end();
  });

  api.put('/usuarios/me/datos-facturacion/:id/principal', async (req, res) => {
    const usuId = await currentUser();
    res.json(await profiles.markPrincipal(usuId, parseId(req.params.id)));
  });

  api.get('/internal/usuarios/:usuId/datos-facturacion/principal', requireServiceToken(config.serviceToken), async (req, res) => {
    const usuId = parseId(req.params.usuId, 'usu_id');
    const profile = await profiles.findPrincipal(usuId);
    if (!profile) throw AppError.notFound(`El usuario ${usuId} no tiene perfil de facturación.`, 'BILLING_PROFILE_NOT_FOUND');
    res.json(profile);
  });

  return createHttpService({
    service: 'ms-billing-profile',
    logger,
    health: () => checkHealth('ms-billing-profile', dataSource),
    routes: (app) => app.use(config.basePath, api),
  });
}
