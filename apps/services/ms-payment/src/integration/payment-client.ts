import type { EsbClient } from '@atracciones/platform';
import type { MetodoPagoDto, PagoDto, PagoInput } from '../contract';
import type { PaymentOperation } from './esb-routes';

/**
 * Cliente de Payment a través del ESB (operaciones de `MS_PAYMENT_ROUTES`). Las demás operaciones se llaman con `call`.
 *
 * - Order: `listMethods`, `createPayment`, `cancelPayment` y `listOrderPayments`.
 * - Refund: `listOrderPayments`.
 */
export class PaymentClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'payment',
  ) {}

  call<T>(operation: PaymentOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  listMethods(): Promise<MetodoPagoDto[]> {
    return this.call('listMethods');
  }

  createPayment(input: PagoInput): Promise<PagoDto> {
    return this.call('createPayment', input);
  }

  cancelPayment(id: number): Promise<PagoDto> {
    return this.call('cancelPayment', { id });
  }

  listOrderPayments(ordId: number): Promise<PagoDto[]> {
    return this.call('listOrderPayments', { ordId });
  }

  getPayment(id: number): Promise<PagoDto> {
    return this.call('getPayment', { id });
  }
}
