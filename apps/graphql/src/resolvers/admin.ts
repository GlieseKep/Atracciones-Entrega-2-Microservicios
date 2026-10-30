import { addDays, AppError, todayIn } from '@atracciones/platform';
import { CACHE_KEYS, type GraphqlContext } from '../context';
import type { AdminSlotDto, OrderSummaryDto, Page, PaymentDto, ProfileDto, ReservationDto, TariffDto } from '../dto';
import { hhmm, toPayment, toProfile, toTariff, usd } from '../mappers';
import { attractionByCode, resolveCode } from './catalog';
import { toContactMessage } from './cart';
import { orderPage, reservationArgs, reservationPage } from './orders';

/** Servicios cuya salud muestra la administración (cada uno por su ruta `<servicio>.health` del ESB). */
export const SERVICES = ['identity', 'catalog', 'inventory', 'cart', 'order', 'booking', 'payment', 'invoicing', 'audit'] as const;

const pageArgs = (args: { limit: number; offset: number }, max = 100) => ({ limit: Math.min(Math.max(args.limit, 1), max), offset: Math.max(args.offset, 0) });
const countBy = (rows: { key: string; count: number; amount?: number }[]) => rows.map((r) => ({ key: r.key, count: r.count, amount: r.amount ?? null }));

const toSlot = (s: AdminSlotDto) => ({
  attractionId: s.atraccion_codigo, date: s.fecha, time: hhmm(s.hora), capacity: s.cupos_totales, reserved: s.cupos_reservados,
  available: s.cupos_disponibles, closed: s.cerrado, guideCode: s.guia_codigo,
});

interface DraftDto {
  uuid: string; codigo_publico: string; slug: string; activa: boolean; nombre: string; descripcion_corta: string; descripcion: string;
  categoria_codigo: string; ciudad_id: number; operador_codigo: string; duracion_horas: number; incluye_comida: boolean; incluye_transporte: boolean;
  incluye_guia: boolean; punto_encuentro: { direccion: string; latitud: number; longitud: number; instrucciones: string | null; google_maps_url: string | null };
  accesible_silla_ruedas: boolean; accesible_carriola: boolean; admite_animales_asistencia: boolean;
  cancelacion: { gratuita: boolean; horas_limite: number; descripcion: string | null }; permite_paquete: boolean;
  idiomas: string[]; inclusiones: string[]; exclusiones: string[]; fotos: string[];
  itinerario: { hora: string; titulo: string; descripcion: string | null; duracion_minutos: number; nombre_ubicacion: string | null }[];
}

const toDraft = (d: DraftDto) => ({
  id: d.codigo_publico, uuid: d.uuid, slug: d.slug, active: d.activa, name: d.nombre, shortDescription: d.descripcion_corta, description: d.descripcion,
  categoryId: d.categoria_codigo, cityId: d.ciudad_id, providerCode: d.operador_codigo, durationHours: d.duracion_horas,
  includesFood: d.incluye_comida, includesTransport: d.incluye_transporte, includesGuide: d.incluye_guia,
  meetingPoint: { address: d.punto_encuentro.direccion, latitude: d.punto_encuentro.latitud, longitude: d.punto_encuentro.longitud, instructions: d.punto_encuentro.instrucciones, googleMapsUrl: d.punto_encuentro.google_maps_url },
  accessibility: { wheelchair: d.accesible_silla_ruedas, stroller: d.accesible_carriola, serviceAnimals: d.admite_animales_asistencia },
  freeCancellation: d.cancelacion.gratuita, cancellationHours: d.cancelacion.horas_limite, cancellationPolicy: d.cancelacion.descripcion,
  packageAllowed: d.permite_paquete, languages: d.idiomas, inclusions: d.inclusiones, exclusions: d.exclusiones, photos: d.fotos,
  itinerary: d.itinerario.map((p, i) => ({ stop: i + 1, time: hhmm(p.hora), title: p.titulo, description: p.descripcion, durationMinutes: p.duracion_minutos, location: p.nombre_ubicacion })),
});

interface AttractionInputArg {
  name: string; shortDescription: string; description: string; categoryId: string; cityId: number; providerCode?: string | null; durationHours: number;
  includesFood?: boolean | null; includesTransport?: boolean | null; includesGuide?: boolean | null;
  meetingPoint: { address: string; latitude: number; longitude: number; instructions?: string | null; googleMapsUrl?: string | null };
  wheelchair?: boolean | null; stroller?: boolean | null; serviceAnimals?: boolean | null; freeCancellation?: boolean | null;
  cancellationHours?: number | null; cancellationPolicy?: string | null; packageAllowed?: boolean | null;
  languages?: string[] | null; inclusions?: string[] | null; exclusions?: string[] | null; photos: string[];
  itinerary?: { time: string; title: string; description?: string | null; durationMinutes: number; location?: string | null }[] | null;
}

const toAttractionBody = (i: AttractionInputArg) => ({
  nombre: i.name, descripcion_corta: i.shortDescription, descripcion: i.description, categoria_codigo: i.categoryId, ciudad_id: i.cityId,
  operador_codigo: i.providerCode ?? undefined, duracion_horas: i.durationHours,
  incluye_comida: i.includesFood === true, incluye_transporte: i.includesTransport === true, incluye_guia: i.includesGuide === true,
  punto_encuentro: { direccion: i.meetingPoint.address, latitud: i.meetingPoint.latitude, longitud: i.meetingPoint.longitude, instrucciones: i.meetingPoint.instructions, google_maps_url: i.meetingPoint.googleMapsUrl },
  accesible_silla_ruedas: i.wheelchair === true, accesible_carriola: i.stroller === true, admite_animales_asistencia: i.serviceAnimals === true,
  cancelacion: { gratuita: i.freeCancellation === true, horas_limite: i.cancellationHours ?? 24, descripcion: i.cancellationPolicy },
  permite_paquete: i.packageAllowed === true, idiomas: i.languages ?? [], inclusiones: i.inclusions ?? [], exclusiones: i.exclusions ?? [], fotos: i.photos,
  itinerario: (i.itinerary ?? []).map((p) => ({ hora: p.time, titulo: p.title, descripcion: p.description, duracion_minutos: p.durationMinutes, nombre_ubicacion: p.location })),
});

/** Tras cambiar el catálogo se vacía el read model de inmediato (el evento llega después y lo vuelve a vaciar). */
const invalidateCatalog = (ctx: GraphqlContext) => ctx.cache.deletePrefix(CACHE_KEYS.catalog);

export const adminResolvers = {
  Query: {
    adminDashboard: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const today = todayIn(ctx.config.timeZone);
      const [all, active, users, reservations, sales, capacity] = await Promise.all([
        ctx.esb.call<Page<unknown>>('catalog', 'adminListAttractions', { limit: 1 }),
        ctx.esb.call<Page<unknown>>('catalog', 'adminListAttractions', { limit: 1, activa: true }),
        ctx.esb.call<{ total: number; por_estado: Record<string, number> }>('identity', 'userStats'),
        ctx.esb.call<{ por_estado: { estado: string; reservas: number }[] }>('booking', 'reservationStats', {}),
        ctx.esb.call<{ ingresos: number; moneda: string; por_estado: { estado: string; ordenes: number; monto: number }[] }>('order', 'salesReport', { desde: '2000-01-01', hasta: today }),
        ctx.esb.call<{ turnos: number; cupos_totales: number; cupos_reservados: number }>('inventory', 'capacitySummary', { fecha_desde: today, fecha_hasta: addDays(today, 30) }),
      ]);
      return {
        attractions: all.total,
        activeAttractions: active.total,
        users: users.total,
        usersByStatus: countBy(Object.entries(users.por_estado).map(([key, count]) => ({ key, count }))),
        reservationsByStatus: countBy(reservations.por_estado.map((r) => ({ key: r.estado, count: r.reservas }))),
        ordersByStatus: countBy(sales.por_estado.map((o) => ({ key: o.estado, count: o.ordenes, amount: o.monto }))),
        revenue: usd(sales.ingresos, sales.moneda),
        upcoming: { slots: capacity.turnos, capacity: capacity.cupos_totales, reserved: capacity.cupos_reservados },
      };
    },

    adminUsers: async (_: unknown, args: { search?: string; status?: string; role?: string; limit: number; offset: number }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const page = pageArgs(args);
      const result = await ctx.esb.call<Page<ProfileDto>>('identity', 'listUsers', { search: args.search, estado: args.status, rol: args.role, ...page });
      return { items: result.items.map((u) => toProfile(u)), total: result.total, ...page };
    },

    adminRoles: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const roles = await ctx.esb.call<{ nombre: string; descripcion: string | null; scopes: string[]; usuarios: number }[]>('identity', 'listRoles');
      return roles.map((r) => ({ name: r.nombre, description: r.descripcion, scopes: r.scopes, users: r.usuarios }));
    },

    adminReservations: async (_: unknown, args: Parameters<typeof reservationArgs>[0], ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const input = { ...reservationArgs(args), todas: true, atraccion_codigo: args.attractionId ? await resolveCode(ctx, args.attractionId) : '' };
      return reservationPage(await ctx.esb.call<Page<ReservationDto>>('booking', 'listReservations', input), input.limit, input.offset);
    },

    adminOrders: async (_: unknown, args: { status?: string; from?: string; to?: string; search?: string; paymentMethod?: string; limit: number; offset: number }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const page = pageArgs(args);
      const result = await ctx.esb.call<Page<OrderSummaryDto>>('order', 'listOrders', {
        todas: true, estado: args.status ?? '', desde: args.from ?? '', hasta: args.to ?? '', search: args.search ?? '', metodo_pago: args.paymentMethod ?? '', ...page,
      });
      return orderPage(result, page.limit, page.offset);
    },

    adminPayments: async (_: unknown, args: { status?: string; method?: string; limit: number; offset: number }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const page = pageArgs(args);
      const result = await ctx.esb.call<Page<PaymentDto>>('payment', 'listPayments', { estado: args.status, metodo_pago: args.method, ...page });
      return { items: result.items.map((p) => toPayment(p)), total: result.total, ...page };
    },

    adminSlots: async (_: unknown, args: { attractionId?: string; from?: string; to?: string; limit: number; offset: number }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const page = pageArgs(args, 500);
      const result = await ctx.esb.call<Page<AdminSlotDto>>('inventory', 'listSlots', {
        atraccion_codigo: args.attractionId ? await resolveCode(ctx, args.attractionId) : '', fecha_desde: args.from ?? '', fecha_hasta: args.to ?? '', ...page,
      });
      return { items: result.items.map(toSlot), total: result.total, ...page };
    },

    adminAttractions: async (_: unknown, args: { search?: string; active?: boolean; limit: number; offset: number }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const page = pageArgs(args);
      const result = await ctx.esb.call<Page<Record<string, unknown>>>('catalog', 'adminListAttractions', { search: args.search, activa: args.active, ...page });
      return {
        items: result.items.map((a) => ({
          id: a.codigo_publico, uuid: a.uuid, slug: a.slug, name: a.nombre, city: a.ciudad, categoryId: a.categoria_codigo, category: a.categoria,
          active: a.activa, popularity: a.popularidad, priceFrom: a.precio_desde_adulto, photo: a.foto, updatedAt: a.actualizado_en,
        })),
        total: result.total,
        ...page,
      };
    },

    adminAttraction: async (_: unknown, args: { id: string }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      try {
        return toDraft(await ctx.esb.call<DraftDto>('catalog', 'adminGetAttraction', { codigo: args.id }));
      } catch (error) {
        if (error instanceof AppError && error.status === 404) return null;
        throw error;
      }
    },

    /** Público: los filtros del listado y los formularios de la administración usan las mismas listas del catálogo. */
    catalogReferences: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      const r = await ctx.esb.call<{
        ciudades: { id: number; nombre: string; provincia: string }[];
        categorias: { codigo: string; nombre: string; padre_codigo: string | null; incluye_comida: boolean; incluye_transporte: boolean; incluye_guia: boolean }[];
        operadores: { codigo: string; nombre_comercial: string }[];
        idiomas: { codigo_iso: string; nombre: string }[];
      }>('catalog', 'getReferences');
      return {
        cities: r.ciudades.map((c) => ({ id: c.id, name: c.nombre, province: c.provincia })),
        categories: r.categorias.map((c) => ({ id: c.codigo, name: c.nombre, parentId: c.padre_codigo, includesFood: c.incluye_comida, includesTransport: c.incluye_transporte, includesGuide: c.incluye_guia })),
        providers: r.operadores.map((o) => ({ code: o.codigo, name: o.nombre_comercial })),
        languages: r.idiomas.map((l) => ({ code: l.codigo_iso.trim(), name: l.nombre })),
      };
    },

    salesReport: async (_: unknown, args: { from?: string; to?: string }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const [sales, reservations] = await Promise.all([
        ctx.esb.call<{
          desde: string; hasta: string; moneda: string; ingresos: number; ordenes: number;
          por_atraccion: { atraccion_codigo: string; ordenes: number; boletos: number; ingresos: number }[];
          por_dia: { fecha: string; ordenes: number; boletos: number; ingresos: number }[];
          por_metodo: { metodo_pago: string; ordenes: number; ingresos: number }[];
          por_estado: { estado: string; ordenes: number; monto: number }[];
        }>('order', 'salesReport', { desde: args.from ?? '', hasta: args.to ?? '' }),
        ctx.esb.call<{ por_atraccion: { atraccion_codigo: string; reservas: number; boletos: number }[] }>('booking', 'reservationStats', { fecha_desde: args.from ?? '', fecha_hasta: args.to ?? '' }),
      ]);
      return {
        from: sales.desde,
        to: sales.hasta,
        currency: sales.moneda,
        revenue: sales.ingresos,
        orders: sales.ordenes,
        byAttraction: sales.por_atraccion.map((a) => ({ attractionId: a.atraccion_codigo, orders: a.ordenes, tickets: a.boletos, revenue: a.ingresos })),
        byDay: sales.por_dia.map((d) => ({ date: d.fecha, orders: d.ordenes, tickets: d.boletos, revenue: d.ingresos })),
        byMethod: sales.por_metodo.map((m) => ({ method: m.metodo_pago, orders: m.ordenes, revenue: m.ingresos })),
        byStatus: countBy(sales.por_estado.map((s) => ({ key: s.estado, count: s.ordenes, amount: s.monto }))),
        reservationsByAttraction: reservations.por_atraccion.map((r) => ({ attractionId: r.atraccion_codigo, reservations: r.reservas, tickets: r.boletos })),
      };
    },

    auditLog: async (_: unknown, args: { eventType?: string; aggregateId?: string; correlationId?: string; service?: string; from?: string; to?: string; limit: number; offset: number }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const page = pageArgs(args, 200);
      const result = await ctx.esb.call<Page<Record<string, unknown>>>('audit', 'listAuditLog', {
        tipo_evento: args.eventType, agregado_id: args.aggregateId, correlation_id: args.correlationId, servicio: args.service, desde: args.from, hasta: args.to, ...page,
      });
      return {
        items: result.items.map((e) => ({
          eventId: e.event_id, eventType: e.tipo_evento, service: e.servicio_origen, aggregateType: e.tipo_agregado, aggregateId: e.agregado_id,
          correlationId: e.correlation_id, payload: e.payload, occurredAt: e.ocurrido_en,
        })),
        total: result.total,
        ...page,
      };
    },

    eventTypes: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const rows = await ctx.esb.call<{ nombre: string; servicio_origen: string; tipo_agregado: string }[]>('audit', 'listEventTypes');
      return rows.map((t) => ({ name: t.nombre, service: t.servicio_origen, aggregateType: t.tipo_agregado }));
    },

    contactMessages: async (_: unknown, args: { status?: string; limit: number; offset: number }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const page = pageArgs(args);
      const result = await ctx.esb.call<Page<Record<string, string>>>('audit', 'listContactMessages', { estado: args.status, ...page });
      return { items: result.items.map(toContactMessage), total: result.total, ...page };
    },

    /** Salud de cada microservicio a través del ESB (reemplaza las métricas en memoria del monolito). */
    systemHealth: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const services = await Promise.all(SERVICES.map(async (service) => {
        const begin = performance.now();
        try {
          const h = await ctx.esb.call<{ status: string; database_connected: boolean | null; memory_usage_mb: number; uptime_seconds: number }>(service, 'health', {}, { timeoutMs: 2000 });
          return { service, status: h.status, latencyMs: Math.round(performance.now() - begin), databaseConnected: h.database_connected ?? null, memoryMb: h.memory_usage_mb ?? null, uptimeSeconds: h.uptime_seconds ?? null, error: null };
        } catch (error) {
          // Un /health con 503 llega como error: el servicio responde pero está degradado o sin base de datos.
          return { service, status: 'DOWN', latencyMs: Math.round(performance.now() - begin), databaseConnected: null, memoryMb: null, uptimeSeconds: null, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      const down = services.filter((s) => s.status !== 'UP').length;
      return { status: down === 0 ? 'UP' : down === services.length ? 'DOWN' : 'DEGRADED', checkedAt: new Date().toISOString(), services };
    },
  },

  Mutation: {
    createAttraction: async (_: unknown, args: { input: AttractionInputArg }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const draft = await ctx.esb.call<DraftDto>('catalog', 'adminCreateAttraction', toAttractionBody(args.input));
      await invalidateCatalog(ctx);
      return toDraft(draft);
    },
    updateAttraction: async (_: unknown, args: { id: string; input: AttractionInputArg }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const draft = await ctx.esb.call<DraftDto>('catalog', 'adminUpdateAttraction', { ...toAttractionBody(args.input), codigo: args.id });
      await invalidateCatalog(ctx);
      return toDraft(draft);
    },
    setAttractionActive: async (_: unknown, args: { id: string; active: boolean }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const draft = await ctx.esb.call<DraftDto>('catalog', 'adminSetAttractionActive', { codigo: args.id, activa: args.active });
      await invalidateCatalog(ctx);
      return toDraft(draft);
    },
    setTariff: async (_: unknown, args: { attractionId: string; input: { adult: number; child: number; senior: number; infant: number; student?: number | null; currency?: string | null; validFrom?: string | null } }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const i = args.input;
      const tariff = await ctx.esb.call<TariffDto>('inventory', 'setTariff', {
        atraccion_codigo: args.attractionId, moneda: i.currency ?? 'USD', adult: i.adult, child: i.child, senior: i.senior, infant: i.infant,
        student: i.student ?? 0, has_student: i.student !== null && i.student !== undefined, vigente_desde: i.validFrom ?? '',
      });
      await invalidateCatalog(ctx);
      return toTariff(tariff);
    },
    upsertSlots: async (_: unknown, { input }: { input: { attractionId: string; from: string; to?: string | null; times: string[]; capacity: number; guideCode?: string | null } }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const r = await ctx.esb.call<{ creados: number; actualizados: number }>('inventory', 'upsertSlots', {
        atraccion_codigo: input.attractionId, fecha_desde: input.from, fecha_hasta: input.to ?? input.from, horas: input.times, cupos_totales: input.capacity, guia_codigo: input.guideCode ?? '',
      });
      return { created: r.creados, updated: r.actualizados };
    },
    setSlotCapacity: async (_: unknown, args: { attractionId: string; date: string; time: string; capacity: number }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      return toSlot(await ctx.esb.call<AdminSlotDto>('inventory', 'setSlotCapacity', { atraccion_codigo: args.attractionId, fecha: args.date, hora: args.time, cupos_totales: args.capacity }));
    },
    setSlotClosed: async (_: unknown, args: { attractionId: string; date: string; time: string; closed: boolean }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      return toSlot(await ctx.esb.call<AdminSlotDto>('inventory', 'setSlotClosed', { atraccion_codigo: args.attractionId, fecha: args.date, hora: args.time, cerrado: args.closed }));
    },
    setUserStatus: async (_: unknown, args: { userId: string; status: string }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      return toProfile(await ctx.esb.call<ProfileDto>('identity', 'setUserStatus', { id: args.userId, estado: args.status }));
    },
    grantRole: async (_: unknown, args: { userId: string; role: string; reason?: string }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      return toProfile(await ctx.esb.call<ProfileDto>('identity', 'grantRole', { id: args.userId, rol: args.role, motivo: args.reason }));
    },
    revokeRole: async (_: unknown, args: { userId: string; role: string }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      return toProfile(await ctx.esb.call<ProfileDto>('identity', 'revokeRole', { id: args.userId, rol: args.role }));
    },
    setContactMessageStatus: async (_: unknown, args: { id: string; status: string }, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      return toContactMessage(await ctx.esb.call<Record<string, string>>('audit', 'setContactMessageStatus', { id: args.id, estado: args.status }));
    },
  },

  AdminSlot: {
    attraction: (s: { attractionId: string }, _: unknown, ctx: GraphqlContext) => attractionByCode(ctx, s.attractionId),
    guide: (s: { guideCode: string }, _: unknown, ctx: GraphqlContext) => (s.guideCode ? ctx.loaders.guide.load(s.guideCode) : null),
  },
  AttractionDraft: {
    tariff: async (d: { id: string }, _: unknown, ctx: GraphqlContext) => {
      const t = await ctx.loaders.tariff.load(d.id);
      return t ? toTariff(t) : null;
    },
  },
  SalesByAttraction: {
    attraction: (s: { attractionId: string }, _: unknown, ctx: GraphqlContext) => attractionByCode(ctx, s.attractionId),
  },
  ReservationsByAttraction: {
    attraction: (s: { attractionId: string }, _: unknown, ctx: GraphqlContext) => attractionByCode(ctx, s.attractionId),
  },
};
