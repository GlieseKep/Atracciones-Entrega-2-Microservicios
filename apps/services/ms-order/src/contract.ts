/** Tipos del contrato `Plan/ms_order/order.proto`. */
export const TICKET_TYPES = ['ADULT', 'CHILD', 'SENIOR', 'INFANT', 'STUDENT'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const METHODS = ['CREDIT_CARD', 'DEBIT_CARD', 'PAYPAL', 'TRANSFER'] as const;
export type MetodoCodigo = (typeof METHODS)[number];

export type OrderState = 'CREADA' | 'PAGADA' | 'CANCELADA' | 'REEMBOLSADA';

export interface TicketLine {
  ticket_type: TicketType;
  cantidad: number;
}

/** `CreateOrderRequest` validado. */
export interface CreateOrderInput {
  idempotencyKey: string;
  atrId: number;
  atrCodigo: string;
  atraccionNombre: string;
  boletos: TicketLine[];
  metodo: MetodoCodigo;
  cartItemId: number | null;
  couponCode: string | null;
  observaciones: string | null;
  fecha: string;
}

export interface OrderSummary {
  ord_id: number;
  ord_numero: string;
  det_id_adulto: number;
  estado: OrderState;
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
  moneda: string;
}

export interface OrderLine {
  det_id: number;
  atr_id: number;
  descripcion: string;
  ticket_type: TicketType;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface OrderDetail {
  orden: OrderSummary;
  usu_id: number;
  cla_id: number;
  metodo: string;
  lineas: OrderLine[];
  fecha: string;
}

export interface CardData {
  marca: string;
  ultimos4: string;
  titular: string;
  mes: number;
  anio: number;
  pais: string;
}

export interface StartPaymentResponse {
  pag_id: number;
  estado_pago: string;
  estado_orden: OrderState;
}

/** Dueño de una orden: un usuario del portal o un cliente API. */
export interface OrderOwner {
  usuId: number | null;
  claId: number | null;
}

/** Tipo en `outbox` de los avisos a Cart. No va al bus: lo entrega `CartSync`, que reintenta. */
export const CART_SYNC_EVENT = 'CART_SYNC';

export interface CartSyncPayload {
  accion: 'confirmar' | 'liberar';
  cai_id: number;
  ord_numero: string;
}
