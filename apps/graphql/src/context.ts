import DataLoader from 'dataloader';
import { AppError, cached, isAdmin, type Cache, type EsbClient, type Principal } from '@atracciones/platform';
import type { GraphqlConfig } from './config';
import type { AttractionDetailDto, AttractionSummaryDto, CategoryNodeDto, OrderDetailDto, ProfileDto, ReservationDto, TariffDto, TimeSlotDto } from './dto';
import { toGraphqlError } from './errors';

/** Prefijos de la caché de lectura (read models, plan D6). Se invalidan por eventos en `invalidateOn`. */
export const CACHE_KEYS = {
  categories: 'catalogo:categorias',
  detail: (id: string) => `catalogo:detalle:${id}`,
  search: (hash: string) => `catalogo:busqueda:${hash}`,
  catalog: 'catalogo:',
  orders: (principalId: string, args: string) => `ordenes:${principalId}:${args}`,
  ordersOf: (principalId: string) => `ordenes:${principalId}:`,
  allOrders: 'ordenes:',
} as const;

export interface Loaders {
  /** Resumen de atracciones activas por código público (una búsqueda en Catalog por lote). */
  summary: DataLoader<string, AttractionSummaryDto | null>;
  /** Detalle por código, slug o uuid (read model con TTL). */
  detail: DataLoader<string, AttractionDetailDto | null>;
  /** Tarifa vigente hoy por código (un `GetTariffs` de Inventory por lote). */
  tariff: DataLoader<string, TariffDto | null>;
  /** Nombre visible del guía por código. */
  guide: DataLoader<string, string | null>;
  /** Usuarios por id (solo administración: Identity exige el scope). */
  user: DataLoader<string, ProfileDto | null>;
  /** Detalle de una orden (líneas, pasos, pagos, comprobantes) por id o external_order_id. */
  orderDetail: DataLoader<string, OrderDetailDto | null>;
  /** Reserva por external_order_id, PNR o uuid. */
  reservation: DataLoader<string, ReservationDto | null>;
  /** Turnos a la venta de una atracción en una fecha (clave `codigo|fecha`), en tiempo real (sin caché). */
  availability: DataLoader<string, TimeSlotDto[]>;
}

export interface GraphqlContext {
  esb: EsbClient;
  cache: Cache;
  config: GraphqlConfig;
  principal: Principal | null;
  loaders: Loaders;
  /** Códigos de las atracciones favoritas del usuario (se consultan una vez por petición). */
  favorites(): Promise<Set<string>>;
  categories(): Promise<CategoryNodeDto[]>;
  requireUser(): Principal;
  requireAdmin(): Principal;
}

const notFoundAsNull = async <T>(work: Promise<T>): Promise<T | null> => {
  try {
    return await work;
  } catch (error) {
    if (error instanceof AppError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
};

export function createContext(esb: EsbClient, cache: Cache, config: GraphqlConfig, principal: Principal | null): GraphqlContext {
  const loaders: Loaders = {
    summary: new DataLoader(async (codes) => {
      const result = await esb.call<{ items: AttractionSummaryDto[] }>('catalog', 'searchAttractions', { codigos: codes, page: 1, limit: codes.length });
      const byCode = new Map(result.items.map((a) => [a.codigo_publico.trim(), a]));
      return codes.map((c) => byCode.get(c) ?? null);
    }, { maxBatchSize: 100 }),

    detail: new DataLoader((ids) =>
      Promise.all(ids.map((id) => cached(cache, CACHE_KEYS.detail(id), config.cacheSeconds.catalog, () =>
        notFoundAsNull(esb.call<AttractionDetailDto>('catalog', 'getAttraction', { id })))))),

    tariff: new DataLoader(async (codes) => {
      const result = await esb.call<{ tarifas: TariffDto[] }>('inventory', 'getTariffs', { atraccion_codigos: codes, fecha: '' });
      const byCode = new Map((result.tarifas ?? []).map((t) => [t.atraccion_codigo.trim(), t]));
      return codes.map((c) => byCode.get(c) ?? null);
    }, { maxBatchSize: 200 }),

    guide: new DataLoader((codes) =>
      Promise.all(codes.map(async (codigo) => (await notFoundAsNull(esb.call<{ nombre_visible: string }>('inventory', 'getGuide', { codigo })))?.nombre_visible ?? null))),

    user: new DataLoader(async (ids) => {
      const users = await esb.call<ProfileDto[]>('identity', 'getUsers', { ids });
      const byId = new Map(users.map((u) => [u.id, u]));
      return ids.map((id) => byId.get(id) ?? null);
    }, { maxBatchSize: 100 }),

    orderDetail: new DataLoader((ids) => Promise.all(ids.map((id) => notFoundAsNull(esb.call<OrderDetailDto>('order', 'getOrder', { id }))))),

    reservation: new DataLoader((ids) => Promise.all(ids.map((id) => notFoundAsNull(esb.call<ReservationDto>('booking', 'getReservation', { id }))))),

    availability: new DataLoader((keys) => Promise.all(keys.map(async (key) => {
      const [atraccion_codigo, fecha] = key.split('|');
      return (await esb.call<{ turnos: TimeSlotDto[] }>('inventory', 'getAvailability', { atraccion_codigo, fecha })).turnos ?? [];
    }))),
  };

  let favorites: Promise<Set<string>> | null = null;
  return {
    esb,
    cache,
    config,
    principal,
    loaders,
    favorites() {
      if (!principal || principal.tipo !== 'USUARIO') return Promise.resolve(new Set());
      favorites ??= esb.call<{ atraccion_codigo: string }[]>('cart', 'listFavorites').then((rows) => new Set(rows.map((r) => r.atraccion_codigo)));
      return favorites;
    },
    categories: () => cached(cache, CACHE_KEYS.categories, config.cacheSeconds.catalog, () => esb.call<CategoryNodeDto[]>('catalog', 'getCategoryTree')),
    requireUser() {
      if (!principal) throw toGraphqlError(AppError.unauthorized('Inicia sesión para continuar.'));
      return principal;
    },
    requireAdmin() {
      const p = this.requireUser();
      if (!isAdmin(p)) throw toGraphqlError(AppError.forbidden('Necesitas permisos de administración.', 'INSUFFICIENT_SCOPE'));
      return p;
    },
  };
}
