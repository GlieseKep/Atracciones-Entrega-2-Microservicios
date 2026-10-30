import { AppError, cached, currentCorrelationId, requireScope, type Cache, type EsbClient, type Logger } from '@atracciones/platform';
import type { ContractV2Schema } from '@atracciones/contracts';
import type { Request, Response } from 'express';
import { aliased, type ContractRequest } from '../request';
import {
  toAgreement,
  toAvailability,
  toCard,
  toCategoryFlat,
  toCategoryNode,
  toDetail,
  type AttractionDetailDto,
  type AttractionSummaryDto,
  type CategoryFlatDto,
  type CategoryNodeDto,
  type PromotionAgreementDto,
  type TariffDto,
  type TimeSlotDto,
} from '../mappers/catalog';

type SearchRequest = ContractV2Schema<'SearchAtraccionesRequestV2'>;
type SearchResponse = ContractV2Schema<'SearchAtraccionesResponseV2'>;

/** Filtros internos de Catalog (el contrato los nombra igual salvo `categoria_id` y `city`). */
interface CatalogFilters {
  query?: string;
  ciudad?: string;
  categoria?: string;
  incluye_comida?: boolean;
  incluye_transporte?: boolean;
  incluye_guia?: boolean;
  precio_min?: number;
  precio_max?: number;
  duracion_max_horas?: number;
  idioma_guia?: string;
  accesible_silla_ruedas?: boolean;
  animales_asistencia?: boolean;
  cancelacion_gratuita?: boolean;
  sort?: string;
}

const CACHE_SECONDS = { categories: 60, detail: 30 };
const PUBLIC_CACHE = 'public, max-age=60';

const flag = (value: unknown): boolean | undefined => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined);
const positiveInt = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
};

export interface CatalogHandlerDeps {
  esb: EsbClient;
  cache: Cache;
  logger: Logger;
}

export function catalogHandlers({ esb, cache, logger }: CatalogHandlerDeps) {
  const detailOf = (id: string) => cached(cache, `detalle:${id}`, CACHE_SECONDS.detail, () => esb.call<AttractionDetailDto>('catalog', 'getAttraction', { id }));

  /** Busca en Catalog, filtra por disponibilidad en fechas (Inventory) y arma las tarjetas con su tarifa. */
  async function search(filters: CatalogFilters, page: number, limit: number, dates: { from: string; to: string; adults: number } | null): Promise<SearchResponse> {
    let codigos: string[] | undefined;
    if (dates) {
      const all = await esb.call<{ codigos: string[] }>('catalog', 'searchAttractions', { ...filters, solo_codigos: true });
      const available = await esb.call<{ atraccion_codigos: string[] }>('inventory', 'hasAvailability', {
        atraccion_codigos: all.codigos, fecha_inicio: dates.from, fecha_fin: dates.to, cupos_minimos: dates.adults,
      });
      codigos = available.atraccion_codigos ?? [];
    }
    const result = await esb.call<{ total: number; items: AttractionSummaryDto[] }>('catalog', 'searchAttractions', { ...filters, codigos, page, limit });
    const tariffs = result.items.length === 0 ? [] : (await esb.call<{ tarifas: TariffDto[] }>('inventory', 'getTariffs', {
      atraccion_codigos: result.items.map((i) => i.codigo_publico), fecha: dates?.from ?? '',
    })).tarifas ?? [];
    const byCode = new Map(tariffs.map((t) => [t.atraccion_codigo.trim(), t]));
    const data = result.items.flatMap((item) => {
      const tariff = byCode.get(item.codigo_publico);
      if (!tariff) {
        logger.warn('atracción sin tarifa vigente: se omite del listado', { atraccion: item.codigo_publico });
        return [];
      }
      return [toCard(item, tariff)];
    });
    const totalPages = Math.ceil(result.total / limit);
    return {
      request_id: currentCorrelationId() ?? undefined,
      metadata: {
        total_results: result.total,
        page,
        limit,
        total_pages: totalPages,
        next_cursor: page < totalPages ? Buffer.from(JSON.stringify({ page: page + 1 })).toString('base64url') : null,
      },
      data,
    };
  }

  return {
    async categoryTree(_req: Request, res: Response) {
      const tree = await cached(cache, 'categorias:arbol', CACHE_SECONDS.categories, () => esb.call<CategoryNodeDto[]>('catalog', 'getCategoryTree'));
      res.setHeader('Cache-Control', PUBLIC_CACHE).json(tree.map(toCategoryNode));
    },

    async categories(req: Request, res: Response) {
      const padre = typeof req.query.padre_id === 'string' ? req.query.padre_id : '';
      const rows = await cached(cache, `categorias:${padre}`, CACHE_SECONDS.categories, () => esb.call<CategoryFlatDto[]>('catalog', 'listCategories', padre ? { padre } : {}));
      res.setHeader('Cache-Control', PUBLIC_CACHE).json(rows.map(toCategoryFlat));
    },

    async list(req: Request, res: Response) {
      const q = req.query;
      const filters: CatalogFilters = {
        ciudad: typeof q.city === 'string' ? q.city : undefined,
        categoria: typeof q.categoria_id === 'string' ? q.categoria_id : undefined,
        incluye_comida: flag(q.incluye_comida),
        incluye_transporte: flag(q.incluye_transporte),
        incluye_guia: flag(q.incluye_guia),
        sort: typeof q.sort === 'string' ? q.sort : 'POPULARITY',
      };
      res.setHeader('Cache-Control', 'public, max-age=30').json(await search(filters, positiveInt(q.page, 1), positiveInt(q.limit, 10), null));
    },

    async search(req: Request, res: Response) {
      const body = (req.body ?? {}) as SearchRequest;
      const sent = (req as ContractRequest).sentBody ?? {};
      if (sent.adult_count !== undefined && sent.cantidad_adultos !== undefined && sent.adult_count !== sent.cantidad_adultos) {
        throw AppError.validation('adult_count y cantidad_adultos deben coincidir.', [{ name: 'cantidad_adultos', reason: 'Debe ser igual a adult_count.' }], 'ALIAS_CONFLICT');
      }
      const from = body.fecha_inicio ?? body.fecha_fin;
      const to = body.fecha_fin ?? body.fecha_inicio;
      if (from && to && to < from) throw AppError.validation('fecha_fin no puede ser anterior a fecha_inicio.', [{ name: 'fecha_fin', reason: 'Debe ser igual o posterior a fecha_inicio.' }]);
      const filters: CatalogFilters = {
        query: body.query,
        ciudad: body.ciudad,
        categoria: body.categoria_id,
        incluye_comida: body.incluye_comida,
        incluye_transporte: body.incluye_transporte,
        incluye_guia: body.incluye_guia,
        precio_min: body.precio_min,
        precio_max: body.precio_max,
        duracion_max_horas: body.duracion_max_horas,
        idioma_guia: body.idioma_guia,
        accesible_silla_ruedas: body.accesible_silla_ruedas,
        animales_asistencia: body.animales_asistencia,
        cancelacion_gratuita: body.cancelacion_gratuita,
      };
      const adults = aliased(sent, 'adult_count', 'cantidad_adultos', 1);
      res.json(await search(filters, body.page ?? 1, body.limit ?? 10, from && to ? { from, to, adults } : null));
    },

    async detail(req: Request, res: Response) {
      const attraction = await detailOf(String(req.params.id));
      const tariff = await esb.call<TariffDto>('inventory', 'getTariff', { atraccion_codigo: attraction.codigo_publico, fecha: '' });
      res.setHeader('Cache-Control', PUBLIC_CACHE).json(toDetail(attraction, tariff));
    },

    /** Disponibilidad en tiempo real: siempre desde la tabla de turnos de Inventory, nunca desde caché (plan C4). */
    async availability(req: Request, res: Response) {
      const attraction = await detailOf(String(req.params.id));
      const date = String(req.query.date);
      const day = await esb.call<{ turnos: TimeSlotDto[] }>('inventory', 'getAvailability', { atraccion_codigo: attraction.codigo_publico, fecha: date });
      res.setHeader('Cache-Control', 'no-store').json(toAvailability(attraction.codigo_publico, date, day.turnos ?? []));
    },

    async getAgreement(req: Request, res: Response) {
      requireScope((req as ContractRequest).principal!, 'promotions:read');
      res.json(toAgreement(await esb.call<PromotionAgreementDto>('catalog', 'getPromotionAgreement')));
    },

    async putAgreement(req: Request, res: Response) {
      requireScope((req as ContractRequest).principal!, 'promotions:write');
      const agreement = await esb.call<PromotionAgreementDto>('catalog', 'updatePromotionAgreement', req.body ?? {});
      // El acuerdo cambia `permite_paquete` y `porcentaje_descuento_paquete` de los detalles en caché.
      await cache.deletePrefix('detalle:');
      res.json(toAgreement(agreement));
    },
  };
}
