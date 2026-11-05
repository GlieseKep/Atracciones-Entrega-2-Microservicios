import type { Invoice, OrderDetail } from '@/types/order';
import { gql } from './client';

/** Orden de ms-order por su número (`external_order_id` de la reserva). La crea Booking: el portal solo la consulta. */
export const getOrder = (ordNumero: string, signal?: AbortSignal) => gql.query<OrderDetail>('orderGetOrder', { ord_numero: ordNumero }, { signal });

/** Factura electrónica de la orden (ms-invoicing). */
export const getOrderInvoice = (ordId: number, signal?: AbortSignal) => gql.query<Invoice>('invoicingGetOrderInvoice', { ordId }, { signal });
