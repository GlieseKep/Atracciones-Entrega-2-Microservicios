import { AppError, hasRole, requirePrincipal, type EsbClient, type Logger, type Principal } from '@atracciones/platform';
import type { CreateOrderInput, OrderDetail, OrderOwner, OrderState, OrderSummary, TicketType } from '../contract';
import type { IdempotencyRepository, IdempotencySubject } from '../persistence/idempotency-repository';
import type { OrderRepository, OrderRow } from '../persistence/order-repository';
import { validateCoupon } from './coupons';
import { onceByKey } from './idempotency';
import type { PaymentMethods } from './payment-methods';
import { orderTotals } from './totals';

interface Quote {
  currency: string;
  lines: { ticket_type: TicketType; cantidad: number; unit_price: number; subtotal: number }[];
  total: number;
}

interface CartItem {
  attraction_id: string;
  status: string;
}

interface Payment {
  id: number;
  estado: string;
}

/** `usu_id` o `cla_id` salen del principal autenticado. */
export function ownerOf(principal: Principal): OrderOwner {
  const id = Number(principal.id);
  if (!Number.isSafeInteger(id)) throw AppError.forbidden('El principal no identifica a un usuario ni a un cliente API.');
  return principal.tipo === 'USUARIO' ? { usuId: id, claId: null } : { usuId: null, claId: id };
}

export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly methods: PaymentMethods,
    private readonly esb: EsbClient,
    private readonly secret: string,
    private readonly logger: Logger,
  ) {}

  async requireByNumber(numero: string): Promise<OrderRow> {
    const row = await this.orders.findByNumber(numero);
    if (!row) throw AppError.notFound(`No existe la orden ${numero}.`, 'ORDER_NOT_FOUND');
    return row;
  }

  async create(input: CreateOrderInput): Promise<OrderSummary> {
    const owner = ownerOf(await requirePrincipal(this.secret));
    const subject: IdempotencySubject = owner.usuId !== null ? { tipo: 'USUARIO', id: owner.usuId } : { tipo: 'CLIENTE_API', id: owner.claId as number };
    if (owner.claId !== null && (input.cartItemId !== null || input.couponCode !== null)) {
      throw AppError.validation('Booking Prototipo no usa carrito ni cupones.');
    }
    return onceByKey(this.idempotency, input.idempotencyKey, subject, 'CreateOrder', input, () => this.createOnce(input, owner));
  }

  private async createOnce(input: CreateOrderInput, owner: OrderOwner): Promise<OrderSummary> {
    if (input.cartItemId !== null) await this.assertCartItem(input, owner.usuId as number);
    const quote = await this.esb.call<Quote>('pricing', 'quoteTickets', { attraction_id: input.atrCodigo, date: input.fecha, boletos: input.boletos });
    const coupon = input.couponCode ? await validateCoupon(this.esb, input.couponCode, quote.total) : null;
    const row = await this.orders.create({
      owner,
      caiId: input.cartItemId,
      mpaId: await this.methods.idOf(input.metodo),
      atrId: input.atrId,
      nombre: input.atraccionNombre,
      moneda: quote.currency,
      observaciones: input.observaciones,
      totals: orderTotals(quote.total, coupon?.descuento ?? 0),
      lines: quote.lines.map((line) => ({ type: line.ticket_type, cantidad: line.cantidad, unitPrice: line.unit_price, subtotal: line.subtotal })),
      coupon: coupon ? { cupId: coupon.cupId, maxUses: coupon.maxUses } : null,
    });
    if (input.cartItemId !== null) await this.linkCartItem(input, row);
    return this.orders.summary(row);
  }

  private async assertCartItem(input: CreateOrderInput, usuId: number): Promise<void> {
    const item = await this.esb.call<CartItem>('cart', 'getItem', { itemId: input.cartItemId, usu_id: usuId });
    if (item.attraction_id !== input.atrCodigo) throw AppError.unprocessable('CART_ITEM_MISMATCH', 'El ítem es de otra atracción.');
    if (item.status !== 'PENDIENTE') throw AppError.conflict('CART_ITEM_ALREADY_ORDERED', 'El ítem ya está en otra orden.');
  }

  /** Si Cart rechaza el ítem, la orden se cancela: no debe quedar una orden sin su ítem en pago. */
  private async linkCartItem(input: CreateOrderInput, row: OrderRow): Promise<void> {
    try {
      await this.esb.call('cart', 'linkItem', { itemId: input.cartItemId, external_order_id: row.ord_numero }, { idempotencyKey: input.idempotencyKey });
    } catch (error) {
      await this.orders.cancel(Number(row.ord_id));
      throw error;
    }
  }

  /** Cancela el pago pendiente y la orden. Una orden pagada no se cancela aquí: se reembolsa con Refund. */
  async cancel(numero: string, motivo: string): Promise<OrderSummary> {
    const row = await this.requireByNumber(numero);
    if (row.est_codigo === 'PAGADA' || row.est_codigo === 'REEMBOLSADA') throw AppError.conflict('ORDER_ALREADY_PAID', 'Una orden pagada se reembolsa con Refund.');
    if (row.est_codigo === 'CREADA') {
      await this.cancelPendingPayments(Number(row.ord_id));
      await this.orders.cancel(Number(row.ord_id));
      this.logger.info('orden cancelada', { ord_numero: numero, motivo });
    }
    return this.orders.summary(await this.requireByNumber(numero));
  }

  async cancelPendingPayments(ordId: number): Promise<void> {
    const payments = await this.esb.call<Payment[]>('payment', 'listOrderPayments', { ordId });
    for (const payment of payments) {
      if (payment.estado === 'PENDIENTE') await this.esb.call('payment', 'cancelPayment', { id: payment.id });
    }
  }

  async detail(ordId: number, ordNumero: string): Promise<OrderDetail> {
    const row = ordId > 0 ? await this.orders.findById(ordId) : await this.orders.findByNumber(ordNumero);
    if (!row) throw AppError.notFound('No existe la orden.', 'ORDER_NOT_FOUND');
    return this.orders.detail(row, await this.methods.codeOf(row.mpa_id));
  }

  /** Cada quien ve lo suyo; `todas` es solo para `ADMIN`. */
  async list(todas: boolean, estado: string, page: number, limit: number) {
    const principal = await requirePrincipal(this.secret);
    if (todas && !hasRole(principal, 'ADMIN')) throw AppError.forbidden('Ver todas las órdenes requiere el rol ADMIN.');
    const { total, items } = await this.orders.list(todas ? null : ownerOf(principal), (estado as OrderState) || null, page || 1, Math.min(limit || 20, 100));
    return { total_results: total, items };
  }
}
