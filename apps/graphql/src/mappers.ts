import { money, slotId, timeLabel } from '@atracciones/platform';
import type { CartDto, OrderSummaryDto, PaymentDto, ReservationDto, TariffDto, TimeSlotDto } from './dto';

/** `HH:mm:ss` → `HH:mm` (la hora que muestra y envía el portal). */
export const hhmm = (time: string) => time.slice(0, 5);
export const orNull = (value: string | null | undefined) => (value ? value : null);
export const usd = (amount: number, currency = 'USD') => ({ amount: money(amount), currency });

export const slotStatus = (available: number) => (available <= 0 ? 'AGOTADO' : available <= 3 ? 'ULTIMOS_CUPOS' : 'DISPONIBLE');

export function toTariff(t: TariffDto) {
  return { currency: t.moneda, adult: t.adult, child: t.child, senior: t.senior, infant: t.infant, student: t.has_student ? t.student : null };
}

/** Precio de un tipo de boleto en la tarifa (`null` si la atracción no lo vende, como STUDENT sin tarifa). */
export function priceOf(t: TariffDto, type: string): number | null {
  switch (type) {
    case 'ADULT': return t.adult;
    case 'CHILD': return t.child;
    case 'SENIOR': return t.senior;
    case 'INFANT': return t.infant;
    case 'STUDENT': return t.has_student ? t.student : null;
    default: return null;
  }
}

export function toTimeSlot(t: TimeSlotDto) {
  return {
    slotId: slotId(t.fecha, t.hora),
    date: t.fecha,
    time: hhmm(t.hora),
    label: timeLabel(t.hora),
    capacity: t.cupos_totales,
    available: t.cupos_disponibles,
    status: slotStatus(t.cupos_disponibles),
    adultPrice: t.precio_adulto || null,
    childPrice: t.precio_nino || null,
    guideCode: t.guia_codigo,
  };
}

export const toTickets = (boletos: { ticket_type: string; cantidad: number }[]) => boletos.map((b) => ({ type: b.ticket_type, quantity: b.cantidad }));

export function toReservation(r: ReservationDto) {
  return {
    id: r.reservation_id,
    code: r.reservation_code,
    externalOrderId: r.external_order_id,
    status: r.status,
    attractionId: r.atraccion_codigo.trim(),
    date: r.fecha,
    time: hhmm(r.hora),
    tickets: toTickets(r.boletos),
    ticketCount: r.boletos.reduce((s, b) => s + b.cantidad, 0),
    total: usd(r.total, r.moneda || 'USD'),
    customer: {
      fullName: r.customer.full_name, email: r.customer.email, phone: r.customer.phone, documentType: r.customer.document_type, documentId: r.customer.document_id,
    },
    passengers: r.passengers.map((p) => ({ fullName: p.full_name, documentId: orNull(p.document_id), ticketType: p.ticket_type })),
    guideCode: r.guia_codigo,
    meetingPoint: r.punto_encuentro,
    notes: orNull(r.observaciones),
    voucher: r.voucher_qr_payload,
    cancellableUntil: orNull(r.cancelable_hasta),
    canCancel: (r.status === 'CONFIRMED' || r.status === 'PENDING') && !!r.cancelable_hasta && Date.parse(r.cancelable_hasta) > Date.now(),
    checkedInAt: orNull(r.checkin_en),
    cancelledAt: orNull(r.cancelado_en),
    cancellationReason: orNull(r.cancelacion_motivo),
    refundCode: orNull(r.reembolso_codigo),
    refundedAmount: r.reembolso_codigo ? r.monto_reembolsado : null,
    createdAt: r.creado_en,
    principalTipo: r.principal_tipo,
    principalId: r.principal_id,
  };
}
export type ReservationModel = ReturnType<typeof toReservation>;

export function toOrder(o: OrderSummaryDto) {
  return {
    id: o.id,
    externalOrderId: o.external_order_id,
    status: o.estado,
    sagaStatus: o.estado_saga,
    paymentMethod: o.metodo_pago,
    total: usd(o.total, o.moneda),
    attractionId: o.atraccion_codigo || null,
    date: o.fecha || null,
    time: o.hora ? hhmm(o.hora) : null,
    ticketCount: o.boletos,
    createdAt: o.creado_en,
    updatedAt: o.actualizado_en,
    correlationId: o.correlation_id,
    principalTipo: o.principal_tipo,
    principalId: o.principal_id,
  };
}
export type OrderModel = ReturnType<typeof toOrder>;

export function toPayment(p: PaymentDto, currency = 'USD') {
  return {
    id: p.pago_id,
    orderId: p.orden_id ?? '',
    method: p.metodo_pago,
    status: p.estado,
    amount: usd(p.monto, p.moneda ?? currency),
    refunded: p.reembolsado,
    gatewayReference: orNull(p.referencia_pasarela),
    rejectionReason: orNull(p.motivo_rechazo),
    createdAt: p.creado_en,
    processedAt: orNull(p.procesado_en),
    refunds: p.reembolsos.map((r) => ({ code: r.codigo, amount: r.monto, reason: r.motivo, requestedBy: r.solicitante, status: r.estado, issuedAt: orNull(r.emitido_en) })),
  };
}

export function toCartItems(cart: CartDto) {
  return cart.items.map((i) => ({
    id: i.id,
    attractionId: i.atraccion_codigo,
    date: i.fecha,
    time: hhmm(i.hora),
    hora: i.hora,
    tickets: toTickets(i.boletos),
    ticketCount: i.boletos.reduce((s, b) => s + b.cantidad, 0),
    boletos: i.boletos,
  }));
}
export type CartItemModel = ReturnType<typeof toCartItems>[number];

export function toProfile(p: { id: string; email: string; nombre_completo: string; tipo: string; estado: string; roles: string[]; creado_en: string }, scopes: string[] = []) {
  return { id: p.id, email: p.email, fullName: p.nombre_completo, type: p.tipo, status: p.estado, roles: p.roles, scopes, createdAt: p.creado_en };
}
