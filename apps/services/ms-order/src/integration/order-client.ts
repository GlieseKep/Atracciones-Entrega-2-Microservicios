import type { EsbClient } from '@atracciones/platform';
import type { CardData, OrderDetail, OrderSummary, StartPaymentResponse } from '../contract';
import type { OrderOperation } from './esb-routes';

/**
 * Cliente de Order a través del ESB (operaciones de `MS_ORDER_ROUTES`).
 *
 * - Booking: `createOrder`, `startPayment`, `cancelOrder` y `getOrder`.
 * - Invoicing y Payment: `getOrder`.
 * - GraphQL: `listOrders`.
 */
export class OrderClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'order',
  ) {}

  private call<T>(operation: OrderOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  createOrder(input: object): Promise<OrderSummary> {
    return this.call('createOrder', input);
  }

  startPayment(ordNumero: string, tarjeta?: CardData): Promise<StartPaymentResponse> {
    return this.call('startPayment', tarjeta ? { ord_numero: ordNumero, tarjeta } : { ord_numero: ordNumero });
  }

  cancelOrder(ordNumero: string, motivo: string): Promise<OrderSummary> {
    return this.call('cancelOrder', { ord_numero: ordNumero, motivo });
  }

  getOrder(reference: { ord_id?: number; ord_numero?: string }): Promise<OrderDetail> {
    return this.call('getOrder', reference);
  }

  listOrders(filters: { todas?: boolean; estado?: string; page?: number; limit?: number } = {}): Promise<{ total_results: number; items: OrderSummary[] }> {
    return this.call('listOrders', filters);
  }
}
