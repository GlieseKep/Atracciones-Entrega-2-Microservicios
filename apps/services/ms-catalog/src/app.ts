import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  EsbClient,
  requirePrincipal,
  requireServiceToken,
  type DatabaseSettings,
  type EventHandler,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express, type RequestHandler } from 'express';
import type { DataSource } from 'typeorm';
import {
  parseCategory,
  parseCategoryPatch,
  parseGuide,
  parseGuidePatch,
  parseInclusion,
  parseOperator,
  parseOperatorPatch,
  parseOperatorUser,
} from './application/admin-input';
import { parseAttraction } from './application/attraction-input';
import { AttractionService } from './application/attraction-service';
import { eventHandler } from './application/event-handlers';
import { asBody, pathId, queryBoolean, queryInteger, queryText } from './application/fields';
import { Locations } from './application/locations';
import { Permissions, type Staff } from './application/permissions';
import { AttractionSearch, parseListQuery, parseSearchBody } from './application/search';
import { ATTRACTION_STATES, INCLUSION_TYPES, type AttractionState, type CategoryFlat, type CategoryTreeNode, type InclusionType } from './contract';
import { CATALOG_BASE_PATH } from './integration/esb-routes';
import { AttractionRepository } from './persistence/attraction-repository';
import { CategoryRepository, type CategoryRow } from './persistence/category-repository';
import { GuideRepository } from './persistence/guide-repository';
import { InclusionRepository } from './persistence/inclusion-repository';
import { OperatorRepository } from './persistence/operator-repository';

export interface MsCatalogConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Cabecera `X-Service-Token` de las rutas `/internal/**`. */
  serviceToken: string;
  basePath: string;
  esbUrl: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsCatalogConfig(env: NodeJS.ProcessEnv = process.env): MsCatalogConfig {
  return {
    port: Number(env.PORT ?? 4019),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_catalog', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    basePath: env.BASE_PATH ?? CATALOG_BASE_PATH,
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    nodeId: env.NODE_ID ?? 'node-dilan-catalog-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_CATALOG',
  };
}

export interface MsCatalogDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

export interface MsCatalogService {
  app: Express;
  /** Consumidor de `RESENA_PUBLICADA` y `TARIFA_ACTUALIZADA`. */
  onEvent: EventHandler;
}

const VERSION = '1.0.0';

const toFlat = (row: CategoryRow): CategoryFlat => ({
  id: row.cat_codigo,
  padre_id: row.padre_codigo,
  nombre: row.cat_nombre,
  slug: row.cat_slug,
  incluye_comida: row.cat_incluye_comida,
  incluye_transporte: row.cat_incluye_transporte,
  incluye_guia: row.cat_incluye_guia,
});

/** Una subcategoría de una categoría inactiva queda fuera, porque el árbol parte de las raíces activas. */
function categoryTree(rows: CategoryRow[]): CategoryTreeNode[] {
  const nodeOf = (row: CategoryRow): CategoryTreeNode => ({
    id: row.cat_codigo,
    nombre: row.cat_nombre,
    slug: row.cat_slug,
    ...(row.cat_descripcion ? { descripcion: row.cat_descripcion } : {}),
    icono: row.cat_icono,
    incluye_comida: row.cat_incluye_comida,
    incluye_transporte: row.cat_incluye_transporte,
    incluye_guia: row.cat_incluye_guia,
    orden: row.cat_orden,
    subcategorias: rows.filter((child) => child.cat_padre_id === row.cat_id).map(nodeOf),
  });
  return rows.filter((row) => row.cat_padre_id === null).map(nodeOf);
}

/**
 * Catalog & Attractions Service (REST, contrato `Plan/ms_catalog/ms_catalog-openapi.yaml`): operadores, guías, categorías,
 * idiomas, inclusiones y atracciones. Expone las cinco rutas públicas de catálogo del contrato v3.
 */
export function createMsCatalogService(config: MsCatalogConfig, dataSource: DataSource, deps: MsCatalogDependencies = {}): MsCatalogService {
  const logger = deps.logger ?? createLogger('ms-catalog');
  const esb = deps.esb ?? new EsbClient(config.esbUrl);
  const attractions = new AttractionRepository(dataSource);
  const categories = new CategoryRepository(dataSource);
  const operators = new OperatorRepository(dataSource);
  const guides = new GuideRepository(dataSource);
  const inclusions = new InclusionRepository(dataSource);
  const locations = new Locations(esb, logger);
  const permissions = new Permissions(config.internalTokenSecret, operators);
  const search = new AttractionSearch(attractions, locations, esb);
  const service = new AttractionService(dataSource, attractions, operators, guides, locations, permissions, esb, logger);
  const internal = requireServiceToken(config.serviceToken);

  /** Servicios internos con `X-Service-Token`, o cualquier usuario autenticado. */
  const serviceOrUser: RequestHandler = async (req, res, next) => {
    if (req.get('x-service-token')) return internal(req, res, next);
    await requirePrincipal(config.internalTokenSecret);
    next();
  };

  async function operatorIdOf(codigo: string): Promise<number> {
    const opeId = await operators.idByCode(codigo);
    if (opeId === null) throw AppError.notFound(`No existe el operador ${codigo}.`, 'OPERATOR_NOT_FOUND');
    return opeId;
  }

  /** Filtro `operador` de una lista: un `OPERADOR` solo ve lo suyo. */
  async function scopedOperators(staff: Staff, operador: string | null): Promise<number[] | null> {
    if (!operador) return staff.opeIds;
    const opeId = await operators.idByCode(operador);
    if (opeId === null) return [];
    permissions.assertOperator(staff, opeId);
    return [opeId];
  }

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-catalog', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  // Catálogo público (contrato v3). `/atracciones/{id}` va al final, para no capturar las demás.

  api.get('/atracciones/categorias/arbol', async (_req, res) => {
    res.json(categoryTree(await categories.listActive()));
  });

  api.get('/atracciones/categorias', async (req, res) => {
    res.json((await categories.listChildren(queryText(req.query.padre_id))).map(toFlat));
  });

  api.post('/atracciones/search', async (req, res) => {
    res.json(await search.run(parseSearchBody(req.body)));
  });

  api.get('/atracciones', async (req, res) => {
    res.json(await search.run(parseListQuery(req.query as Record<string, unknown>)));
  });

  api.get('/atracciones/:id', async (req, res) => {
    res.json(await service.publicDetail(req.params.id));
  });

  // Guías ----------------------------------------------------------------------

  api.get('/guias', async (req, res) => {
    const staff = await permissions.requireStaff();
    res.json(await guides.list({ opeIds: await scopedOperators(staff, queryText(req.query.operador)), activo: queryBoolean(req.query.activo, 'activo') }));
  });

  api.post('/guias', async (req, res) => {
    const staff = await permissions.requireStaff();
    const input = parseGuide(req.body);
    const opeId = await operators.idByCode(input.operador);
    if (opeId === null) throw AppError.validation(`No existe el operador ${input.operador}.`, [{ name: 'operador', reason: 'Operador desconocido.' }]);
    permissions.assertOperator(staff, opeId);
    if (input.usuId !== null) await service.assertUser(input.usuId);
    res.status(201).json(await guides.create({ ...input, opeId }));
  });

  api.get('/guias/:codigo', serviceOrUser, async (req, res) => {
    const found = await guides.find(req.params.codigo as string);
    if (!found) throw AppError.notFound(`No existe el guía ${req.params.codigo}.`, 'GUIDE_NOT_FOUND');
    res.json(found.guide);
  });

  api.patch('/guias/:codigo', async (req, res) => {
    const staff = await permissions.requireStaff();
    const codigo = req.params.codigo;
    const found = await guides.find(codigo);
    if (!found) throw AppError.notFound(`No existe el guía ${codigo}.`, 'GUIDE_NOT_FOUND');
    permissions.assertOperator(staff, found.opeId);
    const patch = parseGuidePatch(req.body);
    if (patch.usu_id) await service.assertUser(patch.usu_id);
    res.json(await guides.update(codigo, patch));
  });

  // Rutas internas -------------------------------------------------------------

  api.get('/internal/atracciones/:id/logistica', internal, async (req, res) => {
    const guiId = req.query.gui_id === undefined ? null : pathId(req.query.gui_id, 'gui_id');
    res.json(await service.logistics(req.params.id as string, guiId));
  });

  /** Inventory valida el guía de un horario o turno (sin exigir que la atracción esté publicada). */
  api.get('/internal/atracciones/:id/guias/:guiId', internal, async (req, res) => {
    res.json(await service.guideFor(req.params.id as string, pathId(req.params.guiId, 'gui_id')));
  });

  api.get('/internal/atracciones/:id/referencia', internal, async (req, res) => {
    res.json(await service.reference(req.params.id as string));
  });

  // Operadores -----------------------------------------------------------------

  api.get('/operadores', async (_req, res) => {
    const staff = await permissions.requireStaff();
    res.json(await operators.list(staff.opeIds));
  });

  api.post('/operadores', async (req, res) => {
    await permissions.requireAdmin();
    const input = parseOperator(req.body);
    await locations.assertProvince(input.provId);
    res.status(201).json(await operators.create(input));
  });

  api.patch('/operadores/:codigo', async (req, res) => {
    await permissions.requireAdmin();
    const patch = parseOperatorPatch(req.body);
    if (patch.prov_id !== undefined) await locations.assertProvince(patch.prov_id);
    const operator = await operators.update(req.params.codigo, patch);
    if (!operator) throw AppError.notFound(`No existe el operador ${req.params.codigo}.`, 'OPERATOR_NOT_FOUND');
    res.json(operator);
  });

  api.post('/operadores/:codigo/usuarios', async (req, res) => {
    await permissions.requireAdmin();
    const opeId = await operatorIdOf(req.params.codigo);
    const { usuId, cargo } = parseOperatorUser(req.body);
    await service.assertUser(usuId);
    if (!(await operators.linkUser(opeId, usuId, cargo))) throw AppError.conflict('USER_ALREADY_LINKED', 'El usuario ya está vinculado a este operador.');
    res.status(204).end();
  });

  api.delete('/operadores/:codigo/usuarios/:usuId', async (req, res) => {
    await permissions.requireAdmin();
    const opeId = await operatorIdOf(req.params.codigo);
    if (!(await operators.unlinkUser(opeId, pathId(req.params.usuId, 'usu_id')))) throw AppError.notFound('El usuario no está vinculado a este operador.', 'USER_NOT_LINKED');
    res.status(204).end();
  });

  // Categorías, idiomas e inclusiones ------------------------------------------

  api.post('/categorias', async (req, res) => {
    await permissions.requireAdmin();
    const input = parseCategory(req.body);
    let padreId: number | null = null;
    if (input.padre) {
      const padre = await categories.findByCode(input.padre);
      if (!padre) throw AppError.validation(`No existe la categoría ${input.padre}.`, [{ name: 'padre_id', reason: 'Categoría desconocida.' }]);
      padreId = padre.cat_id;
    }
    res.status(201).json(toFlat(await categories.create(input, padreId)));
  });

  api.patch('/categorias/:codigo', async (req, res) => {
    await permissions.requireAdmin();
    const category = await categories.update(req.params.codigo, parseCategoryPatch(req.body));
    if (!category) throw AppError.notFound(`No existe la categoría ${req.params.codigo}.`, 'CATEGORY_NOT_FOUND');
    res.json(toFlat(category));
  });

  api.get('/idiomas', async (_req, res) => {
    res.json(await inclusions.listLanguages());
  });

  api.get('/inclusiones', async (req, res) => {
    await permissions.requireStaff();
    const tipo = queryText(req.query.tipo);
    if (tipo && !INCLUSION_TYPES.includes(tipo as InclusionType)) {
      throw AppError.validation(`'tipo' debe ser ${INCLUSION_TYPES.join(', ')}.`, [{ name: 'tipo', reason: 'Valor no permitido.' }]);
    }
    res.json(await inclusions.list(tipo as InclusionType | null));
  });

  api.post('/inclusiones', async (req, res) => {
    await permissions.requireAdmin();
    const { tipo, nombre, orden } = parseInclusion(req.body);
    res.status(201).json(await inclusions.create(tipo, nombre, orden));
  });

  // Administración de atracciones ----------------------------------------------

  api.get('/admin/atracciones', async (req, res) => {
    const staff = await permissions.requireStaff();
    const estado = queryText(req.query.estado);
    if (estado && !ATTRACTION_STATES.includes(estado as AttractionState)) {
      throw AppError.validation(`'estado' debe ser ${ATTRACTION_STATES.join(', ')}.`, [{ name: 'estado', reason: 'Valor no permitido.' }]);
    }
    const filters = { estado: estado as AttractionState | null, operador: queryText(req.query.operador), q: queryText(req.query.q) };
    res.json(await service.adminList(filters, queryInteger(req.query.page, 'page', 1, Number.MAX_SAFE_INTEGER), queryInteger(req.query.limit, 'limit', 10, 50), staff));
  });

  api.post('/admin/atracciones', async (req, res) => {
    const staff = await permissions.requireStaff();
    res.status(201).json(await service.create(parseAttraction(req.body), staff));
  });

  api.get('/admin/atracciones/:id', async (req, res) => {
    res.json(await service.adminGet(req.params.id, await permissions.requireStaff()));
  });

  api.put('/admin/atracciones/:id', async (req, res) => {
    const staff = await permissions.requireStaff();
    res.json(await service.update(req.params.id, parseAttraction(req.body), staff));
  });

  api.delete('/admin/atracciones/:id', async (req, res) => {
    await service.remove(req.params.id, await permissions.requireStaff());
    res.status(204).end();
  });

  api.put('/admin/atracciones/:id/estado', async (req, res) => {
    const staff = await permissions.requireStaff();
    const estado = asBody(req.body).estado as AttractionState;
    if (!ATTRACTION_STATES.includes(estado)) throw AppError.validation(`'estado' debe ser ${ATTRACTION_STATES.join(', ')}.`, [{ name: 'estado', reason: 'Valor no permitido.' }]);
    res.json(await service.setState(req.params.id, estado, staff));
  });

  const app = createHttpService({
    service: 'ms-catalog',
    logger,
    health: () => checkHealth('ms-catalog', dataSource),
    routes: (express) => express.use(config.basePath, api),
  });
  return { app, onEvent: eventHandler(attractions, logger) };
}
