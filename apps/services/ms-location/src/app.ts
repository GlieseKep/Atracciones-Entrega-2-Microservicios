import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  requireServiceToken,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { Geography } from './application/geography';
import { parseCityFilters, parseId, parseIds, parseNames } from './application/input';
import { LOCATION_BASE_PATH } from './integration/esb-routes';
import { LocationRepository } from './persistence/location-repository';

export interface MsLocationConfig {
  port: number;
  database: DatabaseSettings;
  /** Cabecera `X-Service-Token` de las rutas `/internal/**`. */
  serviceToken: string;
  basePath: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsLocationConfig(env: NodeJS.ProcessEnv = process.env): MsLocationConfig {
  return {
    port: Number(env.PORT ?? 4014),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_location', ssl: env.DATABASE_SSL === 'true' },
    serviceToken: env.SERVICE_TOKEN ?? '',
    basePath: env.BASE_PATH ?? LOCATION_BASE_PATH,
    nodeId: env.NODE_ID ?? 'node-dilan-location-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_LOCATION',
  };
}

export interface MsLocationDependencies {
  logger?: Logger;
}

const VERSION = '1.0.0';

/**
 * Location Service (REST, contrato `Plan/ms_location/ms_location-openapi.yaml`): catálogo de solo lectura de regiones,
 * provincias y ciudades. Las consultas son públicas; `/internal/**` es para Catalog y Coupon.
 */
export async function createMsLocationService(config: MsLocationConfig, dataSource: DataSource, deps: MsLocationDependencies = {}): Promise<Express> {
  const logger = deps.logger ?? createLogger('ms-location');
  const geography = new Geography(await new LocationRepository(dataSource).load());
  const internal = requireServiceToken(config.serviceToken);

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-location', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  api.get('/regiones', (_req, res) => {
    res.json(geography.tree());
  });

  api.get('/provincias', (req, res) => {
    const region = typeof req.query.region === 'string' ? req.query.region : null;
    if (region !== null && !geography.hasRegion(region)) {
      throw AppError.validation(`La región ${region} no existe.`, [{ name: 'region', reason: 'Región desconocida.' }]);
    }
    res.json(geography.provinces(region));
  });

  api.get('/provincias/:id', (req, res) => {
    const province = geography.province(parseId(req.params.id));
    if (!province) throw AppError.notFound(`No existe la provincia ${req.params.id}.`, 'PROVINCE_NOT_FOUND');
    res.json(province);
  });

  api.get('/ciudades', (req, res) => {
    res.json(geography.cities(parseCityFilters(req.query as Record<string, unknown>)));
  });

  api.get('/ciudades/:id', (req, res) => {
    const city = geography.city(parseId(req.params.id));
    if (!city) throw AppError.notFound(`No existe la ciudad ${req.params.id}.`, 'CITY_NOT_FOUND');
    res.json(city);
  });

  api.post('/internal/ciudades/lote', internal, (req, res) => {
    res.json(geography.citiesByIds(parseIds(req.body)));
  });

  api.post('/internal/ciudades/resolucion', internal, (req, res) => {
    res.json(geography.resolve(parseNames(req.body)));
  });

  return createHttpService({
    service: 'ms-location',
    logger,
    health: () => checkHealth('ms-location', dataSource),
    routes: (app) => app.use(config.basePath, api),
  });
}
