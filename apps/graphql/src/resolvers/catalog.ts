import { createHash } from 'node:crypto';
import { cached, createLogger } from '@atracciones/platform';
import { CACHE_KEYS, type GraphqlContext } from '../context';
import type { AttractionDetailDto, AttractionSummaryDto, CategoryNodeDto, TimeSlotDto } from '../dto';
import { badInput } from '../errors';
import { hhmm, toTariff, toTimeSlot, usd } from '../mappers';

const logger = createLogger('graphql');

/** Atracción en resolución: el resumen (búsquedas) y, si ya se cargó, el detalle. */
export interface AttractionParent {
  code: string;
  summary: AttractionSummaryDto;
  detail?: AttractionDetailDto | null;
}

export const attractionParent = (s: AttractionSummaryDto | AttractionDetailDto): AttractionParent => ({
  code: s.codigo_publico.trim(),
  summary: s,
  ...('descripcion' in s ? { detail: s } : {}),
});

/** Atracción activa por código público (`null` si no existe o está inactiva). */
export async function attractionByCode(ctx: GraphqlContext, code: string | null | undefined): Promise<AttractionParent | null> {
  if (!code) return null;
  const summary = await ctx.loaders.summary.load(code.trim());
  return summary ? attractionParent(summary) : null;
}

/** Código público a partir de un id del portal (código, slug o uuid); 400 si la atracción no existe o no está activa. */
export async function resolveCode(ctx: GraphqlContext, id: string, field = 'attractionId'): Promise<string> {
  const detail = await ctx.loaders.detail.load(id);
  if (!detail) throw badInput(`No existe una atracción activa con el identificador '${id}'.`, [{ name: field, reason: 'Atracción inexistente o inactiva.' }], 'ATTRACTION_NOT_FOUND');
  return detail.codigo_publico.trim();
}

const detailOf = async (a: AttractionParent, ctx: GraphqlContext) => {
  if (a.detail === undefined) a.detail = await ctx.loaders.detail.load(a.code);
  return a.detail;
};

const toCategory = (c: CategoryNodeDto): object => ({
  id: c.codigo, name: c.nombre, slug: c.slug, description: c.descripcion, icon: c.icono,
  includesFood: c.incluye_comida, includesTransport: c.incluye_transporte, includesGuide: c.incluye_guia,
  children: c.subcategorias.map(toCategory),
});

interface FilterArgs {
  query?: string; city?: string; categoryId?: string; includesFood?: boolean; includesTransport?: boolean; includesGuide?: boolean;
  minPrice?: number; maxPrice?: number; maxDurationHours?: number; guideLanguage?: string; wheelchairAccessible?: boolean;
  serviceAnimals?: boolean; freeCancellation?: boolean; dateFrom?: string; dateTo?: string; travelers?: number;
}

/** Busca en Catalog (con el filtro de disponibilidad de Inventory si hay fechas) y omite las atracciones sin tarifa. */
async function search(ctx: GraphqlContext, filter: FilterArgs, sort: string, page: number, limit: number) {
  const filters = {
    query: filter.query, ciudad: filter.city, categoria: filter.categoryId, incluye_comida: filter.includesFood, incluye_transporte: filter.includesTransport,
    incluye_guia: filter.includesGuide, precio_min: filter.minPrice, precio_max: filter.maxPrice, duracion_max_horas: filter.maxDurationHours,
    idioma_guia: filter.guideLanguage, accesible_silla_ruedas: filter.wheelchairAccessible, animales_asistencia: filter.serviceAnimals,
    cancelacion_gratuita: filter.freeCancellation, sort,
  };
  const from = filter.dateFrom ?? filter.dateTo;
  const to = filter.dateTo ?? filter.dateFrom;
  if (from && to && to < from) throw badInput('dateTo no puede ser anterior a dateFrom.', [{ name: 'filter.dateTo', reason: 'Debe ser igual o posterior a dateFrom.' }]);
  let codigos: string[] | undefined;
  if (from && to) {
    const all = await ctx.esb.call<{ codigos: string[] }>('catalog', 'searchAttractions', { ...filters, solo_codigos: true });
    const available = await ctx.esb.call<{ atraccion_codigos: string[] }>('inventory', 'hasAvailability', {
      atraccion_codigos: all.codigos, fecha_inicio: from, fecha_fin: to, cupos_minimos: Math.max(1, filter.travelers ?? 1),
    });
    codigos = available.atraccion_codigos ?? [];
  }
  return ctx.esb.call<{ total: number; items: AttractionSummaryDto[] }>('catalog', 'searchAttractions', { ...filters, codigos, page, limit });
}

export const catalogResolvers = {
  Query: {
    categories: async (_: unknown, __: unknown, ctx: GraphqlContext) => (await ctx.categories()).map(toCategory),

    attractions: async (_: unknown, args: { filter?: FilterArgs; sort: string; page: number; limit: number }, ctx: GraphqlContext) => {
      const page = Math.max(1, args.page);
      const limit = Math.min(Math.max(1, args.limit), 50);
      const filter = args.filter ?? {};
      // Sin fechas el resultado depende solo del catálogo: se guarda en el read model. Con fechas depende de los cupos.
      const load = () => search(ctx, filter, args.sort, page, limit);
      const hash = createHash('sha256').update(JSON.stringify({ filter, sort: args.sort, page, limit })).digest('hex').slice(0, 32);
      const result = filter.dateFrom || filter.dateTo ? await load() : await cached(ctx.cache, CACHE_KEYS.search(hash), ctx.config.cacheSeconds.catalog, load);
      const tariffs = await ctx.loaders.tariff.loadMany(result.items.map((i) => i.codigo_publico.trim()));
      const items = result.items.filter((item, i) => {
        if (tariffs[i] && !(tariffs[i] instanceof Error)) return true;
        logger.warn('atracción sin tarifa vigente: se omite del listado', { atraccion: item.codigo_publico });
        return false;
      });
      return { items: items.map(attractionParent), total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) };
    },

    attraction: async (_: unknown, args: { id: string }, ctx: GraphqlContext) => {
      const detail = await ctx.loaders.detail.load(args.id);
      return detail ? attractionParent(detail) : null;
    },

    /** Disponibilidad en tiempo real: siempre desde Inventory, nunca desde caché (plan C4). */
    availability: async (_: unknown, args: { attractionId: string; date: string }, ctx: GraphqlContext) => {
      const code = await resolveCode(ctx, args.attractionId);
      const slots = await ctx.loaders.availability.load(`${code}|${args.date}`);
      return slots.map(toTimeSlot);
    },
  },

  Attraction: {
    id: (a: AttractionParent) => a.code,
    uuid: (a: AttractionParent) => a.summary.uuid,
    slug: (a: AttractionParent) => a.summary.slug,
    name: (a: AttractionParent) => a.summary.nombre,
    shortDescription: (a: AttractionParent) => a.summary.descripcion_corta,
    city: (a: AttractionParent) => a.summary.ciudad,
    durationHours: (a: AttractionParent) => a.summary.duracion_horas,
    includesFood: (a: AttractionParent) => a.summary.incluye_comida,
    includesTransport: (a: AttractionParent) => a.summary.incluye_transporte,
    includesGuide: (a: AttractionParent) => a.summary.incluye_guia,
    freeCancellation: (a: AttractionParent) => a.summary.cancelacion_gratuita,
    cancellationHours: (a: AttractionParent) => a.summary.cancelacion_horas_limite,
    packageAllowed: (a: AttractionParent) => a.summary.permite_paquete,
    packageDiscountPercent: (a: AttractionParent) => a.summary.porcentaje_descuento_paquete,
    photos: (a: AttractionParent) => a.summary.fotos,
    rating: (a: AttractionParent) => {
      const r = a.summary.calificacion;
      return { score: r.puntuacion, reviews: r.total_resenas, cleanliness: r.limpieza, service: r.servicio, valueForMoney: r.calidad_precio, punctuality: r.puntualidad };
    },
    meetingPoint: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => {
      const d = await detailOf(a, ctx);
      return {
        address: a.summary.punto_encuentro, latitude: d?.pe_latitud ?? null, longitude: d?.pe_longitud ?? null,
        instructions: d?.pe_instrucciones ?? null,
        googleMapsUrl: d ? d.pe_google_maps_url ?? `https://www.google.com/maps?q=${d.pe_latitud},${d.pe_longitud}` : null,
      };
    },
    tariff: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => {
      const t = await ctx.loaders.tariff.load(a.code);
      return t ? toTariff(t) : null;
    },
    priceFrom: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => {
      const t = await ctx.loaders.tariff.load(a.code);
      return t ? usd(t.adult, t.moneda) : null;
    },
    description: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => (await detailOf(a, ctx))?.descripcion ?? null,
    cancellationPolicy: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => (await detailOf(a, ctx))?.cancelacion_descripcion ?? null,
    accessibility: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => {
      const d = await detailOf(a, ctx);
      return d ? { wheelchair: d.accesible_silla_ruedas, stroller: d.accesible_carriola, serviceAnimals: d.admite_animales_asistencia } : null;
    },
    languages: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => (await detailOf(a, ctx))?.idiomas ?? [],
    inclusions: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => (await detailOf(a, ctx))?.inclusiones ?? [],
    exclusions: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => (await detailOf(a, ctx))?.exclusiones ?? [],
    itinerary: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) =>
      ((await detailOf(a, ctx))?.itinerario ?? []).map((p) => ({
        stop: p.numero_parada, time: hhmm(p.hora), title: p.titulo, description: p.descripcion, durationMinutes: p.duracion_minutos, location: p.nombre_ubicacion,
      })),
    provider: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => {
      const p = (await detailOf(a, ctx))?.proveedor;
      return p ? { name: p.nombre_comercial, ruc: p.ruc, emergencyPhone: p.telefono_emergencia, supportEmail: p.email_soporte } : null;
    },
    isFavorite: async (a: AttractionParent, _: unknown, ctx: GraphqlContext) => (await ctx.favorites()).has(a.code),
  },

  TimeSlot: {
    guide: (t: ReturnType<typeof toTimeSlot>, _: unknown, ctx: GraphqlContext) => (t.guideCode ? ctx.loaders.guide.load(t.guideCode) : null),
  },
};

/** Turno vendible de un día (`null` si no existe o ya no está a la venta). */
export async function sellableSlot(ctx: GraphqlContext, code: string, date: string, time: string): Promise<TimeSlotDto | null> {
  const slots = await ctx.loaders.availability.load(`${code}|${date}`);
  return slots.find((s) => hhmm(s.hora) === hhmm(time)) ?? null;
}
