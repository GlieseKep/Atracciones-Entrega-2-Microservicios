import { cached, timeLabel, type Cache, type EsbClient } from '@atracciones/platform';
import type { Request, Response } from 'express';

const CACHE_SECONDS = { categories: 60, detail: 30 };
const PUBLIC_CACHE = 'public, max-age=60';

/** Campos de `AtraccionCardResponseV2` que usa el listado simple (el contrato los trae en inglés y en español). */
interface AttractionCard {
  id: string;
  name?: string;
  nombre?: string;
  price?: unknown;
  precio?: unknown;
  city?: string;
  ciudad?: string;
  duration?: string;
  duracion?: string;
}

export interface CatalogHandlerDeps {
  esb: EsbClient;
  cache: Cache;
}

/**
 * Catálogo del contrato v3. Catalog, Inventory y Coupon ya responden con las formas del contrato: aquí solo se enruta,
 * se guarda en caché lo que cambia poco y se fijan las cabeceras de caché.
 */
export function catalogHandlers({ esb, cache }: CatalogHandlerDeps) {
  return {
    async categoryTree(_req: Request, res: Response) {
      const tree = await cached(cache, 'categorias:arbol', CACHE_SECONDS.categories, () => esb.call<unknown>('catalog', 'getCategoryTree'));
      res.setHeader('Cache-Control', PUBLIC_CACHE).json(tree);
    },

    async categories(req: Request, res: Response) {
      const padre = typeof req.query.padre_id === 'string' ? req.query.padre_id : '';
      const rows = await cached(cache, `categorias:${padre}`, CACHE_SECONDS.categories, () => esb.call<unknown>('catalog', 'listCategories', padre ? { padre_id: padre } : {}));
      res.setHeader('Cache-Control', PUBLIC_CACHE).json(rows);
    },

    /** Listado simple de la guía de socios: la tarjeta de Catalog más las horas de los horarios activos de Inventory. */
    async list(req: Request, res: Response) {
      const page = await esb.call<{ data?: AttractionCard[] }>('catalog', 'listAttractions', req.query);
      const cards = page.data ?? [];
      const { items } = cards.length === 0
        ? { items: [] }
        : await esb.call<{ items?: { atraccion_id: string; horas?: string[] }[] }>('inventory', 'listScheduleTimes', { atraccion_ids: cards.map((card) => card.id) });
      const times = new Map((items ?? []).map((item) => [item.atraccion_id, (item.horas ?? []).map(timeLabel)]));
      res.setHeader('Cache-Control', 'public, max-age=30').json(cards.map((card) => ({
        id: card.id,
        nombre: card.nombre ?? card.name,
        precio: card.precio ?? card.price,
        ciudad: card.ciudad ?? card.city,
        duracion: card.duracion ?? card.duration,
        horarios: times.get(card.id) ?? [],
      })));
    },

    async search(req: Request, res: Response) {
      res.json(await esb.call<unknown>('catalog', 'searchAttractions', req.body ?? {}));
    },

    async detail(req: Request, res: Response) {
      const id = String(req.params.id);
      const attraction = await cached(cache, `detalle:${id}`, CACHE_SECONDS.detail, () => esb.call<unknown>('catalog', 'getAttraction', { id }));
      res.setHeader('Cache-Control', PUBLIC_CACHE).json(attraction);
    },

    /** Disponibilidad en tiempo real: siempre desde Inventory, nunca desde caché. */
    async availability(req: Request, res: Response) {
      const day = await esb.call<unknown>('inventory', 'getAvailability', { id: String(req.params.id), date: String(req.query.date ?? '') });
      res.setHeader('Cache-Control', 'no-store').json(day);
    },

    async getAgreement(_req: Request, res: Response) {
      res.json(await esb.call<unknown>('coupon', 'getAgreement'));
    },

    async putAgreement(req: Request, res: Response) {
      const agreement = await esb.call<unknown>('coupon', 'updateAgreement', req.body ?? {});
      // El acuerdo cambia el descuento de paquete que muestran los detalles en caché.
      await cache.deletePrefix('detalle:');
      res.json(agreement);
    },
  };
}
