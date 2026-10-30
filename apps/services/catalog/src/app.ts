import {
  AppError,
  BUSINESS_TIME_ZONE,
  checkHealth,
  createHttpService,
  currentPrincipal,
  optionalText,
  paging,
  requireAdmin,
  todayIn,
  type DatabaseSettings,
  type EventBus,
} from '@atracciones/platform';
import type { Express } from 'express';
import type { DataSource } from 'typeorm';
import { parseAttractionInput } from './application/attraction-input';
import { CatalogAdminRepository } from './persistence/catalog-admin-repository';
import { CatalogRepository, type CategoryRow, type SearchFilters } from './persistence/catalog-repository';
import { seedCatalog } from './persistence/seed';

export interface CatalogConfig {
  port: number;
  database: DatabaseSettings;
  timeZone: string;
  /** Operador dueño de la tienda: su acuerdo es el de `/promociones/contrato`. */
  storeOperatorCode: string;
  internalTokenSecret: string;
  seedCatalog: boolean;
}

export function readCatalogConfig(env: NodeJS.ProcessEnv = process.env): CatalogConfig {
  return {
    port: Number(env.PORT ?? 4002),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/catalog_db', ssl: env.DATABASE_SSL === 'true' },
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
    storeOperatorCode: env.STORE_OPERATOR_CODE ?? 'proveedor-atracciones-dilan',
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    seedCatalog: (env.SEED_CATALOG ?? 'true') === 'true',
  };
}

export interface CategoryNode extends Omit<CategoryRow, 'id' | 'padre_codigo'> {
  subcategorias: CategoryNode[];
}

/** Árbol de categorías a partir de la lista plana (ordenada por `orden`). */
export function buildTree(rows: CategoryRow[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const { id: _id, padre_codigo: _padre, ...rest } of rows) nodes.set(rest.codigo, { ...rest, subcategorias: [] });
  const roots: CategoryNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.codigo)!;
    const parent = row.padre_codigo ? nodes.get(row.padre_codigo) : undefined;
    (parent ? parent.subcategorias : roots).push(node);
  }
  return roots;
}

const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const SORTS = ['PRICE_ASC', 'PRICE_DESC', 'RATING_DESC', 'POPULARITY'] as const;

function toFilters(body: Record<string, unknown>): SearchFilters {
  const page = Number.isInteger(body.page) && (body.page as number) >= 1 ? (body.page as number) : 1;
  const limit = Number.isInteger(body.limit) && (body.limit as number) >= 1 ? Math.min(body.limit as number, 200) : 10;
  return {
    query: text(body.query),
    ciudad: text(body.ciudad),
    categoria: text(body.categoria),
    incluye_comida: bool(body.incluye_comida),
    incluye_transporte: bool(body.incluye_transporte),
    incluye_guia: bool(body.incluye_guia),
    precio_min: number(body.precio_min),
    precio_max: number(body.precio_max),
    duracion_max_horas: number(body.duracion_max_horas),
    idioma_guia: text(body.idioma_guia),
    accesible_silla_ruedas: bool(body.accesible_silla_ruedas),
    animales_asistencia: bool(body.animales_asistencia),
    cancelacion_gratuita: bool(body.cancelacion_gratuita),
    codigos: Array.isArray(body.codigos) ? body.codigos.map(String) : null,
    sort: SORTS.includes(body.sort as (typeof SORTS)[number]) ? (body.sort as SearchFilters['sort']) : 'POPULARITY',
    page,
    limit,
    solo_codigos: body.solo_codigos === true,
  };
}

export interface CatalogService {
  app: Express;
  repository: CatalogRepository;
  prepare(): Promise<{ seeded: number }>;
  /** Proyecciones desde el bus: la popularidad (orden POPULARITY) suma una por reserva emitida. */
  consume(bus: EventBus): Promise<void>;
}

/** Catalog & Attractions Service (REST, plan §3.2). */
export function createCatalogService(config: CatalogConfig, dataSource: DataSource): CatalogService {
  const today = () => todayIn(config.timeZone);
  const repository = new CatalogRepository(dataSource, today);
  const admin = new CatalogAdminRepository(dataSource);
  const app = createHttpService({
    service: 'catalog',
    health: () => checkHealth('catalog', dataSource),
    routes: (a) => {
      a.get('/categorias/arbol', async (_req, res) => {
        res.json(buildTree(await repository.categories()));
      });
      // Sin `padre` devuelve solo las raíces (contrato: "Si se omite, retorna todas las categorías raíz").
      a.get('/categorias', async (req, res) => {
        const padre = typeof req.query.padre === 'string' && req.query.padre ? req.query.padre : null;
        const rows = (await repository.categories()).filter((c) => c.padre_codigo === padre);
        res.json(rows.map(({ id: _id, ...rest }) => rest));
      });
      a.post('/atracciones/busqueda', async (req, res) => {
        res.json(await repository.search(toFilters(req.body ?? {})));
      });
      a.get('/atracciones/:id', async (req, res) => {
        const detail = await repository.detail(req.params.id);
        if (!detail) throw AppError.notFound(`No existe una atracción activa con el identificador '${req.params.id}'.`, 'ATTRACTION_NOT_FOUND');
        res.json(detail);
      });
      a.get('/promociones/contrato', async (_req, res) => {
        const agreement = await repository.agreement(config.storeOperatorCode);
        if (!agreement) throw AppError.internal('El operador de la tienda no está registrado en el catálogo.');
        res.json(agreement);
      });
      a.put('/promociones/contrato', async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const porcentaje = number(body.porcentaje_descuento_maximo);
        const permite = bool(body.permite_promociones);
        const invalid = [];
        if (permite === null) invalid.push({ name: 'permite_promociones', reason: 'Es obligatorio.' });
        if (porcentaje === null || porcentaje < 0 || porcentaje > 50) invalid.push({ name: 'porcentaje_descuento_maximo', reason: 'Debe estar entre 0 y 50.' });
        if (invalid.length) throw AppError.validation('El acuerdo de promociones no es válido.', invalid);
        const current = await repository.agreement(config.storeOperatorCode);
        const contacto = body.contacto_comercial && typeof body.contacto_comercial === 'object' ? (body.contacto_comercial as Record<string, unknown>) : null;
        const principal = config.internalTokenSecret ? await currentPrincipal(config.internalTokenSecret) : null;
        await repository.saveAgreement(config.storeOperatorCode, {
          permite: permite!,
          porcentaje: porcentaje!,
          destinos: Array.isArray(body.destinos_habilitados) ? body.destinos_habilitados.map(String) : null,
          vigenciaHasta: text(body.vigencia_hasta) ?? current?.vigencia_hasta ?? today(),
          condiciones: text(body.condiciones_combo),
          contacto: contacto ? { nombre: text(contacto.nombre), email: text(contacto.email), telefono: text(contacto.telefono) } : null,
          actor: principal?.tipo === 'USUARIO' ? principal.id : null,
        });
        res.json(await repository.agreement(config.storeOperatorCode));
      });

      // Administración del catálogo (portal, scope attractions:write).
      a.get('/referencias', async (_req, res) => {
        res.json(await admin.references());
      });
      a.get('/admin/atracciones', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const activa = req.query.activa === 'true' ? true : req.query.activa === 'false' ? false : null;
        res.json(await admin.list({ search: optionalText(req.query.search), activa, ...paging(req.query) }));
      });
      a.get('/admin/atracciones/:codigo', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const found = await admin.editable(req.params.codigo);
        if (!found) throw AppError.notFound(`No existe la atracción '${req.params.codigo}'.`, 'ATTRACTION_NOT_FOUND');
        res.json(found);
      });
      a.post('/admin/atracciones', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const input = await validInput(req.body ?? {});
        const codigo = await admin.create(input);
        res.status(201).json(await admin.editable(codigo));
      });
      a.put('/admin/atracciones/:codigo', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const input = await validInput(req.body ?? {});
        if (!(await admin.update(req.params.codigo, input))) throw AppError.notFound(`No existe la atracción '${req.params.codigo}'.`, 'ATTRACTION_NOT_FOUND');
        res.json(await admin.editable(req.params.codigo));
      });
      a.put('/admin/atracciones/:codigo/estado', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        if (typeof req.body?.activa !== 'boolean') throw AppError.validation('Falta el estado.', [{ name: 'activa', reason: 'Debe ser true o false.' }]);
        if (!(await admin.setActive(req.params.codigo, req.body.activa))) throw AppError.notFound(`No existe la atracción '${req.params.codigo}'.`, 'ATTRACTION_NOT_FOUND');
        res.json(await admin.editable(req.params.codigo));
      });
    },
  });

  /** Valida la forma y que existan la categoría, la ciudad, el operador y los idiomas. */
  async function validInput(body: Record<string, unknown>) {
    const input = parseAttractionInput(body, config.storeOperatorCode);
    const missing = await admin.missingReferences(input);
    if (missing.length) throw AppError.validation('La atracción hace referencia a datos inexistentes.', missing.map((name) => ({ name, reason: 'No existe en el catálogo.' })));
    return input;
  }

  return {
    app,
    repository,
    prepare: async () => ({ seeded: config.seedCatalog ? await seedCatalog(dataSource) : 0 }),
    consume: async (bus) => {
      await bus.subscribe('catalog.popularidad', ['booking.ReservaEmitida'], async (event) => {
        const codigo = String(event.data.atraccion_codigo ?? '');
        // Idempotente: la reserva se cuenta una sola vez aunque el evento se reentregue.
        await dataSource.transaction(async (m) => {
          const [nuevo] = await m.query(
            `INSERT INTO evento_procesado (event_id, consumidor) VALUES ($1, 'popularidad') ON CONFLICT DO NOTHING RETURNING 1`,
            [event.id],
          );
          if (nuevo) await m.query(`UPDATE atraccion SET popularidad = popularidad + 1 WHERE codigo_publico = $1`, [codigo]);
        });
      });
      // Réplica del precio de adulto vigente para los filtros `precio_min`/`precio_max` y el orden por precio.
      await bus.subscribe('catalog.precios', ['inventory.TarifaActualizada'], async (event) => {
        if (event.data.vigente_hoy !== true) return;
        await admin.setPriceFrom(String(event.data.atraccion_codigo ?? ''), event.data.adult === undefined ? null : Number(event.data.adult));
      });
    },
  };
}
