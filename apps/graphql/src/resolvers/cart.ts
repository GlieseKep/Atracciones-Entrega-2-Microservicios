import { createHash } from 'node:crypto';
import { AppError, money, normalizeTime, todayIn } from '@atracciones/platform';
import type { GraphqlContext } from '../context';
import type { CartDto } from '../dto';
import { badInput, toGraphqlError } from '../errors';
import { orNull, priceOf, toCartItems, toReservation, usd, type CartItemModel } from '../mappers';
import { attractionByCode, resolveCode, sellableSlot } from './catalog';
import { purchase, requireKey, ticketList, type CustomerArg, type TicketArg } from './orders';

/** Clave de idempotencia de cada ítem del checkout (UUID determinista a partir de la clave del checkout y el ítem). */
export function itemKey(checkoutKey: string, itemId: string): string {
  const h = createHash('sha256').update(`${checkoutKey}:${itemId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const toCart = (cart: CartDto) => ({ id: cart.id, items: toCartItems(cart), updatedAt: cart.actualizado_en, expiresAt: cart.expira_en });
type CartModel = ReturnType<typeof toCart>;

/** Subtotal estimado de un ítem: precios del turno (adulto y niño) y de la tarifa vigente para el resto. */
async function subtotal(ctx: GraphqlContext, item: CartItemModel): Promise<{ amount: number; currency: string } | null> {
  const [slot, tariff] = await Promise.all([sellableSlot(ctx, item.attractionId, item.date, item.time), ctx.loaders.tariff.load(item.attractionId)]);
  if (!tariff) return null;
  let total = 0;
  for (const b of item.boletos) {
    const price = b.ticket_type === 'ADULT' && slot?.precio_adulto ? slot.precio_adulto
      : b.ticket_type === 'CHILD' && slot?.precio_nino ? slot.precio_nino
      : priceOf(tariff, b.ticket_type);
    if (price === null) return null;
    total += price * b.cantidad;
  }
  return usd(money(total), tariff.moneda);
}

export const cartResolvers = {
  Query: {
    cart: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireUser();
      return toCart(await ctx.esb.call<CartDto>('cart', 'getCart'));
    },
    favorites: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireUser();
      const codes = [...(await ctx.favorites())];
      return (await Promise.all(codes.map((c) => attractionByCode(ctx, c)))).filter((a) => a !== null);
    },
  },

  Mutation: {
    addToCart: async (_: unknown, { input }: { input: { attractionId: string; date: string; time: string; tickets: TicketArg[] } }, ctx: GraphqlContext) => {
      ctx.requireUser();
      const hora = normalizeTime(input.time);
      if (!hora) throw badInput('La hora no es válida.', [{ name: 'input.time', reason: 'Formato HH:mm.' }]);
      if (input.date < todayIn(ctx.config.timeZone)) throw badInput(`La fecha ${input.date} ya pasó.`, [{ name: 'input.date', reason: 'Debe ser hoy o una fecha futura.' }], 'DATE_IN_PAST');
      const code = await resolveCode(ctx, input.attractionId, 'input.attractionId');
      if (!(await sellableSlot(ctx, code, input.date, hora))) {
        throw badInput('Ese turno no está a la venta.', [{ name: 'input.time', reason: 'No hay un turno a la venta con esa fecha y hora.' }], 'SLOT_NOT_FOUND');
      }
      return toCart(await ctx.esb.call<CartDto>('cart', 'addItem', { atraccion_codigo: code, fecha: input.date, hora, boletos: ticketList(input.tickets, 'input.tickets') }));
    },
    updateCartItem: async (_: unknown, args: { itemId: string; tickets: TicketArg[] }, ctx: GraphqlContext) => {
      ctx.requireUser();
      return toCart(await ctx.esb.call<CartDto>('cart', 'updateItem', { id: args.itemId, boletos: ticketList(args.tickets) }));
    },
    removeCartItem: async (_: unknown, args: { itemId: string }, ctx: GraphqlContext) => {
      ctx.requireUser();
      return toCart(await ctx.esb.call<CartDto>('cart', 'removeItem', { id: args.itemId }));
    },
    clearCart: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireUser();
      return toCart(await ctx.esb.call<CartDto>('cart', 'clear'));
    },

    /**
     * Compra los ítems del carrito, uno por saga y en orden. Un ítem que falla (sin cupos, pago rechazado) no detiene a
     * los demás: se informa en su resultado y queda en el carrito. Repetir con la misma clave no duplica compras.
     */
    checkoutCart: async (_: unknown, args: { customer: CustomerArg; paymentMethod: string; idempotencyKey: string; itemIds?: string[] | null }, ctx: GraphqlContext) => {
      ctx.requireUser();
      const key = requireKey(args.idempotencyKey);
      const cart = await ctx.esb.call<CartDto>('cart', 'getCart');
      const items = toCartItems(cart).filter((i) => !args.itemIds || args.itemIds.includes(i.id));
      if (items.length === 0) throw badInput('No hay ítems que comprar en el carrito.', [{ name: 'itemIds', reason: 'El carrito está vacío o los ítems no son suyos.' }], 'CART_EMPTY');
      const results = [];
      const purchased: string[] = [];
      for (const item of items) {
        try {
          const reserva = await purchase(ctx, {
            attractionId: item.attractionId, date: item.date, time: item.time, tickets: item.tickets, customer: args.customer, paymentMethod: args.paymentMethod,
          }, itemKey(key, item.id));
          purchased.push(item.id);
          results.push({ itemId: item.id, reservation: toReservation(reserva), error: null });
        } catch (error) {
          const graphql = toGraphqlError(error);
          const status = Number(graphql.extensions.status ?? 500);
          // Un error de los datos del titular aplica a todos los ítems: se informa como error de la operación.
          if (status === 400 && purchased.length === 0 && String(graphql.extensions.reason ?? '').startsWith('INVALID_')) throw graphql;
          if (status >= 500 && !(error instanceof AppError)) throw graphql;
          results.push({ itemId: item.id, reservation: null, error: { code: String(graphql.extensions.reason ?? 'ERROR'), message: graphql.message, status } });
        }
      }
      if (purchased.length) await ctx.esb.call('cart', 'markPurchased', { item_ids: purchased });
      return results;
    },

    addFavorite: async (_: unknown, args: { attractionId: string }, ctx: GraphqlContext) => {
      ctx.requireUser();
      const rows = await ctx.esb.call<{ atraccion_codigo: string }[]>('cart', 'addFavorite', { codigo: await resolveCode(ctx, args.attractionId) });
      return (await Promise.all(rows.map((r) => attractionByCode(ctx, r.atraccion_codigo)))).filter((a) => a !== null);
    },
    removeFavorite: async (_: unknown, args: { attractionId: string }, ctx: GraphqlContext) => {
      ctx.requireUser();
      // Una atracción desactivada también se puede quitar de favoritos (se usa el id tal cual si ya no está activa).
      const detail = await ctx.loaders.detail.load(args.attractionId);
      const rows = await ctx.esb.call<{ atraccion_codigo: string }[]>('cart', 'removeFavorite', { codigo: detail?.codigo_publico.trim() ?? args.attractionId });
      return (await Promise.all(rows.map((r) => attractionByCode(ctx, r.atraccion_codigo)))).filter((a) => a !== null);
    },

    sendContactMessage: async (_: unknown, { input }: { input: { name: string; email: string; subject: string; message: string } }, ctx: GraphqlContext) =>
      toContactMessage(await ctx.esb.call<Record<string, string>>('audit', 'sendContactMessage', {
        nombre: input.name, email: input.email, asunto: input.subject, mensaje: input.message,
      })),
  },

  Cart: {
    total: async (cart: CartModel, _: unknown, ctx: GraphqlContext) => {
      const subtotals = await Promise.all(cart.items.map((i) => subtotal(ctx, i)));
      return usd(money(subtotals.reduce((s, x) => s + (x?.amount ?? 0), 0)), subtotals.find((x) => x)?.currency ?? 'USD');
    },
  },

  CartItem: {
    attraction: (i: CartItemModel, _: unknown, ctx: GraphqlContext) => attractionByCode(ctx, i.attractionId),
    subtotal: (i: CartItemModel, _: unknown, ctx: GraphqlContext) => subtotal(ctx, i),
    available: async (i: CartItemModel, _: unknown, ctx: GraphqlContext) => {
      const slot = await sellableSlot(ctx, i.attractionId, i.date, i.time);
      return !!slot && slot.cupos_disponibles >= i.ticketCount;
    },
  },
};

export const toContactMessage = (m: Record<string, string>) => ({
  id: m.id, name: m.nombre, email: m.email, subject: m.asunto, message: m.mensaje, status: m.estado,
  createdAt: m.creado_en, respondedAt: orNull(m.respondido_en), correlationId: m.correlation_id,
});
