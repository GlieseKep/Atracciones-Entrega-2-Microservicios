import type { EsbClient } from '@atracciones/platform';
import type { ReembolsoDto, ReembolsoPage } from '../contract';
import type { RefundOperation } from './esb-routes';

/** Cliente de Refund a través del ESB (operaciones de `MS_REFUND_ROUTES`), para Booking y GraphQL. */
export class RefundClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'refund',
  ) {}

  private call<T>(operation: RefundOperation, input: object = {}, idempotencyKey?: string): Promise<T> {
    return this.esb.call<T>(this.service, operation, input, idempotencyKey ? { idempotencyKey } : {});
  }

  createRefund(input: { ord_id: number; monto?: number; motivo?: string }, idempotencyKey: string): Promise<ReembolsoDto> {
    return this.call('createRefund', input, idempotencyKey);
  }

  listRefunds(filters: { pag_id?: number; page?: number; limit?: number } = {}): Promise<ReembolsoPage> {
    return this.call('listRefunds', filters);
  }

  getRefund(numero: string): Promise<ReembolsoDto> {
    return this.call('getRefund', { numero });
  }
}
