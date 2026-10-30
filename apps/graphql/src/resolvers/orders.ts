import { AppError, isAdmin, normalizeTime, TIPOS_BOLETO, todayIn, validateCustomer, type InvalidParam } from '@atracciones/platform';
import { CACHE_KEYS, type GraphqlContext } from '../context';
import type { OrderDetailDto, OrderResponseDto, OrderSummaryDto, Page, ReservationDto } from '../dto';
import { badInput, toGraphqlError } from '../errors';
import { hhmm, orNull, toOrder, toPayment, toProfile, toReservation, type OrderModel, type ReservationModel } from '../mappers';
import { attractionByCode, resolveCode } from './catalog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Boletos por compra en el portal (igual que el tope del carrito). */
export const MAX_TICKETS = 20;
const SORTS: Record<string, string> = { DATE_ASC: 'fecha', DATE_DESC: '-fecha', CREATED_DESC: '-creado' };

export interface TicketArg { type: string; quantity: number }
export interface CustomerArg { fullName: string; email: string; phone: string; documentType: string; documentId: string }
export interface PassengerArg { fullName: string; documentId?: string | null; ticketType: string }

type OrderParent = OrderModel & { detail?: OrderDetailDto | null };

export const requireKey = (key: string) => {
  if (!UUID.test(key)) throw badInput('idempotencyKey debe ser un UUID.', [{ name: 'idempotencyKey', reason: 'UUID (una clave nueva por cada intento lógico de compra).' }], 'INVALID_IDEMPOTENCY_KEY');
  return key.toLowerCase();
};

/** Boletos agrupados por tipo: al menos un adulto (el contrato exige adult_count ≥ 1) y como máximo MAX_TICKETS. */
export function ticketList(tickets: TicketArg[], field = 'tickets'): { ticket_type: string; cantidad: number }[] {
  const byType = new Map<string, number>();
  const invalid: InvalidParam[] = [];
  for (const [i, t] of tickets.entries()) {
    if (!Number.isInteger(t.quantity) || t.quantity < 0) invalid.push({ name: `${field}[${i}].quantity`, reason: 'Entero mayor o igual a cero.' });
    else if (t.quantity > 0) byType.set(t.type, (byType.get(t.type) ?? 0) + t.quantity);
  }
  const total = [...byType.values()].reduce((s, n) => s + n, 0);
  if (!invalid.length && !byType.get('ADULT')) invalid.push({ name: field, reason: 'Debe incluir al menos un boleto ADULT.' });
  if (total > MAX_TICKETS) invalid.push({ name: field, reason: `Máximo ${MAX_TICKETS} boletos por compra.` });
  if (invalid.length) throw badInput('Los boletos no son válidos.', invalid, 'INVALID_TICKETS');
  return TIPOS_BOLETO.filter((t) => byType.has(t)).map((t) => ({ ticket_type: t, cantidad: byType.get(t)! }));
}

/** Respuesta de la saga: la reserva o el error de negocio guardado (con su código y parámetros inválidos). */
export function sagaResult(result: OrderResponseDto): ReservationDto {
  if (result.status >= 200 && result.status < 300 && result.reserva) return result.reserva;
  const p = result.problem;
  throw toGraphqlError(new AppError(result.status || 500, p?.code ?? 'SAGA_FAILED', p?.detail ?? 'La operación no se pudo completar.', { invalidParams: p?.invalid_params }));
}

/**
 * Compra de un turno (saga de Order: cupos → pago → reserva). Valida aquí lo que en la Partner API valida el contrato:
 * titular, boletos, pasajeros, fecha y hora.
 */
export async function purchase(
  ctx: GraphqlContext,
  input: { attractionId: string; date: string; time: string; tickets: TicketArg[]; customer: CustomerArg; passengers?: PassengerArg[] | null; paymentMethod: string; notes?: string | null },
  idempotencyKey: string,
): Promise<ReservationDto> {
  const principal = ctx.requireUser();
  const key = requireKey(idempotencyKey);
  if (input.paymentMethod === 'SOA_BOOKING_GATEWAY') {
    throw badInput('SOA_BOOKING_GATEWAY es el método de pago de Booking Prototipo, no del portal.', [{ name: 'paymentMethod', reason: 'Use TARJETA_CREDITO, TRANSFERENCIA o PAGO_EN_SITIO.' }]);
  }
  const hora = normalizeTime(input.time);
  if (!hora) throw badInput('La hora no es válida.', [{ name: 'time', reason: 'Formato HH:mm.' }]);
  if (input.date < todayIn(ctx.config.timeZone)) throw badInput(`La fecha ${input.date} ya pasó.`, [{ name: 'date', reason: 'Debe ser hoy o una fecha futura.' }], 'DATE_IN_PAST');
  const boletos = ticketList(input.tickets);
  const customer = {
    full_name: input.customer.fullName.trim(), email: input.customer.email.trim().toLowerCase(), phone: input.customer.phone.trim(),
    document_type: input.customer.documentType, document_id: input.customer.documentId.trim().toUpperCase(),
  };
  const invalidCustomer = validateCustomer(customer, { prefix: 'customer.', checkEmail: true });
  if (invalidCustomer) throw badInput('Los datos del titular no son válidos.', invalidCustomer.invalid, invalidCustomer.code);
  const passengers = (input.passengers ?? []).map((p) => ({ full_name: p.fullName.trim(), document_id: p.documentId?.trim() ?? '', ticket_type: p.ticketType }));
  const overflow = boletos.filter((b) => passengers.filter((p) => p.ticket_type === b.ticket_type).length > b.cantidad);
  const orphan = passengers.filter((p) => !boletos.some((b) => b.ticket_type === p.ticket_type));
  if (overflow.length || orphan.length) {
    throw badInput('Hay más pasajeros de un tipo que boletos de ese tipo.', [...overflow, ...orphan.map((p) => ({ ticket_type: p.ticket_type }))].map((b) => ({ name: 'passengers', reason: `Sobran pasajeros ${b.ticket_type}.` })), 'PASSENGERS_MISMATCH');
  }
  const code = await resolveCode(ctx, input.attractionId);
  const result = await ctx.esb.call<OrderResponseDto>('order', 'createOrder', {
    idempotency_key: key, atraccion_id: code, fecha: input.date, hora, boletos, customer, passengers,
    payment_method: input.paymentMethod, saga_id: '', observaciones: input.notes?.trim() ?? '',
  }, { idempotencyKey: key, timeoutMs: 15_000 });
  await ctx.cache.deletePrefix(CACHE_KEYS.ordersOf(principal.id));
  return sagaResult(result);
}

/** Cancelación (saga de cancelación de Order: reserva → cupos → reembolso). */
export async function cancel(ctx: GraphqlContext, id: string, reason: string | null | undefined, idempotencyKey: string, solicitante: 'CLIENTE' | 'ADMIN') {
  const principal = solicitante === 'ADMIN' ? ctx.requireAdmin() : ctx.requireUser();
  const key = requireKey(idempotencyKey);
  const result = await ctx.esb.call<OrderResponseDto>('order', 'cancelReservation', {
    idempotency_key: key, reservation_id: id, reason: reason?.trim() ?? '', solicitante,
  }, { idempotencyKey: key, timeoutMs: 15_000 });
  await ctx.cache.deletePrefix(solicitante === 'ADMIN' ? CACHE_KEYS.allOrders : CACHE_KEYS.ordersOf(principal.id));
  return toReservation(sagaResult(result));
}

export const reservationPage = (page: Page<ReservationDto>, limit: number, offset: number) => ({ items: page.items.map(toReservation), total: page.total, limit, offset });
export const orderPage = (page: Page<OrderSummaryDto>, limit: number, offset: number) => ({ items: page.items.map(toOrder), total: page.total, limit, offset });

export const reservationArgs = (args: { status?: string; from?: string; to?: string; attractionId?: string; search?: string; sort?: string; limit: number; offset: number }) => ({
  estado: args.status ?? '', fecha_desde: args.from ?? '', fecha_hasta: args.to ?? '', atraccion_codigo: args.attractionId ?? '', search: args.search ?? '',
  orden: SORTS[args.sort ?? 'CREATED_DESC'], limit: Math.min(Math.max(args.limit, 1), 100), offset: Math.max(args.offset, 0),
});

const orderDetailOf = async (o: OrderParent, ctx: GraphqlContext) => {
  if (o.detail === undefined) o.detail = await ctx.loaders.orderDetail.load(o.id);
  return o.detail;
};

export const ordersResolvers = {
  Query: {
    myReservations: async (_: unknown, args: Parameters<typeof reservationArgs>[0], ctx: GraphqlContext) => {
      ctx.requireUser();
      const input = reservationArgs(args);
      return reservationPage(await ctx.esb.call<Page<ReservationDto>>('booking', 'listReservations', input), input.limit, input.offset);
    },
    reservation: async (_: unknown, args: { id: string }, ctx: GraphqlContext) => {
      ctx.requireUser();
      const r = await ctx.loaders.reservation.load(args.id);
      return r ? toReservation(r) : null;
    },
    /** Resúmenes de órdenes del usuario: read model con TTL corto, invalidado por los eventos de Order. */
    myOrders: async (_: unknown, args: { status?: string; limit: number; offset: number }, ctx: GraphqlContext) => {
      const principal = ctx.requireUser();
      const input = { estado: args.status ?? '', limit: Math.min(Math.max(args.limit, 1), 100), offset: Math.max(args.offset, 0) };
      const key = CACHE_KEYS.orders(principal.id, `${input.estado}:${input.limit}:${input.offset}`);
      const hit = await ctx.cache.get<Page<OrderSummaryDto>>(key);
      const page = hit ?? (await ctx.esb.call<Page<OrderSummaryDto>>('order', 'listOrders', input));
      if (!hit) await ctx.cache.set(key, page, ctx.config.cacheSeconds.orders);
      return orderPage(page, input.limit, input.offset);
    },
    order: async (_: unknown, args: { id: string }, ctx: GraphqlContext) => {
      ctx.requireUser();
      const detail = await ctx.loaders.orderDetail.load(args.id);
      return detail ? { ...toOrder(detail.orden), detail } : null;
    },
  },

  Mutation: {
    purchase: async (_: unknown, args: { input: Parameters<typeof purchase>[1]; idempotencyKey: string }, ctx: GraphqlContext) => {
      const reserva = await purchase(ctx, args.input, args.idempotencyKey);
      return { reservation: toReservation(reserva) };
    },
    cancelReservation: (_: unknown, args: { id: string; reason?: string; idempotencyKey: string }, ctx: GraphqlContext) =>
      cancel(ctx, args.id, args.reason, args.idempotencyKey, 'CLIENTE'),
    adminCancelReservation: (_: unknown, args: { id: string; reason: string; idempotencyKey: string }, ctx: GraphqlContext) =>
      cancel(ctx, args.id, args.reason, args.idempotencyKey, 'ADMIN'),
  },

  PurchaseResult: {
    order: async (r: { reservation: ReservationModel }, _: unknown, ctx: GraphqlContext) => {
      const detail = await ctx.loaders.orderDetail.load(r.reservation.externalOrderId);
      return detail ? { ...toOrder(detail.orden), detail } : null;
    },
  },

  Reservation: {
    attraction: (r: ReservationModel, _: unknown, ctx: GraphqlContext) => attractionByCode(ctx, r.attractionId),
    guide: (r: ReservationModel, _: unknown, ctx: GraphqlContext) => (r.guideCode ? ctx.loaders.guide.load(r.guideCode) : null),
    order: async (r: ReservationModel, _: unknown, ctx: GraphqlContext) => {
      const detail = await ctx.loaders.orderDetail.load(r.externalOrderId);
      return detail ? { ...toOrder(detail.orden), detail } : null;
    },
    owner: (r: ReservationModel, _: unknown, ctx: GraphqlContext) => owner(ctx, r.principalTipo, r.principalId),
  },

  Order: {
    attraction: (o: OrderParent, _: unknown, ctx: GraphqlContext) => attractionByCode(ctx, o.attractionId),
    lines: async (o: OrderParent, _: unknown, ctx: GraphqlContext) =>
      ((await orderDetailOf(o, ctx))?.lineas ?? []).map((l) => ({
        attractionId: l.atraccion_codigo, date: l.fecha, time: hhmm(l.hora),
        tickets: l.boletos.map((b) => ({ type: b.ticket_type, quantity: b.cantidad, unitPrice: b.precio_unitario })),
      })),
    steps: async (o: OrderParent, _: unknown, ctx: GraphqlContext) =>
      ((await orderDetailOf(o, ctx))?.pasos ?? []).map((p) => ({ step: p.paso, action: p.accion, result: p.resultado, detail: orNull(p.detalle), at: p.creado_en })),
    payments: async (o: OrderParent, _: unknown, ctx: GraphqlContext) =>
      ((await orderDetailOf(o, ctx))?.pagos ?? []).map((p) => ({ ...toPayment(p, o.total.currency), orderId: o.id })),
    invoices: async (o: OrderParent, _: unknown, ctx: GraphqlContext) =>
      ((await orderDetailOf(o, ctx))?.facturas ?? []).map((f) => ({
        id: f.id, type: f.tipo_comprobante, number: f.numero, accessKey: f.clave_acceso, status: f.estado_sri,
        authorizationNumber: orNull(f.numero_autorizacion), authorizedAt: orNull(f.fecha_autorizacion), attempts: f.intentos, total: f.total,
      })),
    reservation: async (o: OrderParent, _: unknown, ctx: GraphqlContext) => {
      const r = await ctx.loaders.reservation.load(o.externalOrderId);
      return r ? toReservation(r) : null;
    },
    owner: (o: OrderParent, _: unknown, ctx: GraphqlContext) => owner(ctx, o.principalTipo, o.principalId),
  },

  OrderLine: {
    attraction: (l: { attractionId: string }, _: unknown, ctx: GraphqlContext) => attractionByCode(ctx, l.attractionId),
  },

  Payment: {
    order: async (p: { orderId: string }, _: unknown, ctx: GraphqlContext) => {
      if (!p.orderId) return null;
      const detail = await ctx.loaders.orderDetail.load(p.orderId);
      return detail ? { ...toOrder(detail.orden), detail } : null;
    },
  },
};

/** Dueño de una reserva u orden: solo lo ve un administrador (los datos de otros usuarios no se exponen). */
async function owner(ctx: GraphqlContext, tipo: string, id: string) {
  if (!isAdmin(ctx.principal) || tipo !== 'USUARIO') return null;
  const user = await ctx.loaders.user.load(id);
  return user ? toProfile(user) : null;
}
