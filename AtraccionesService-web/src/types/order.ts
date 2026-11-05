import type { IsoDateTime } from './api';

/** Órdenes de ms-order (las crea Booking en la compra) y facturas de ms-invoicing. */

export type OrderState = 'CREADA' | 'PAGADA' | 'CANCELADA' | 'REEMBOLSADA';

export interface OrderSummary {
  ord_id: number;
  ord_numero: string;
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
  /** Nombre de la atracción con el tipo de boleto, por ejemplo `Tour Quito (ADULT)`. */
  descripcion: string;
  ticket_type: 'ADULT' | 'CHILD' | 'SENIOR' | 'INFANT' | 'STUDENT';
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface OrderDetail {
  orden: OrderSummary;
  metodo: string;
  lineas: OrderLine[];
  fecha: IsoDateTime;
}

export type InvoiceState = 'NO_PAGADA' | 'PAGADA' | 'ANULADA';

export interface Invoice {
  id: number;
  ord_id: number;
  numero: string;
  clave_acceso: string | null;
  autorizacion_sri: string | null;
  estado: InvoiceState;
  estado_sri: 'PENDIENTE' | 'AUTORIZADA' | 'RECHAZADA';
  emitida_en: IsoDateTime;
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
  identificacion: string;
  razon_social: string;
  correo: string;
}
