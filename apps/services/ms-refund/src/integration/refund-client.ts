import type { EsbClient } from '@atracciones/platform';
import type { PaymentRefundsDto, RefundDto, RefundHealthDto, RefundRequestDto, RefundResultDto, RefundStatus } from '../contract';
import type { RefundOperation } from './esb-routes';

/**
 * Cliente de Refund a través del ESB (operaciones de `MS_REFUND_ROUTES`). Usa el principal de la petición en curso: el
 * ESB lo reenvía (cuenta de servicio de Order o GraphQL, o el administrador).
 *
 * - Order: `refund` en la saga de cancelación (misma entrada y salida que `payment.refund`) y `listByPayments` para
 *   devolver los pagos de una orden con sus reembolsos.
 * - GraphQL: `list` y `listByPayments` para el panel de administración.
 */
export class RefundClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'refund',
  ) {}

  private call<T>(operation: RefundOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  health(): Promise<RefundHealthDto> {
    return this.call('health');
  }

  /** Idempotente por `clave_idempotencia`; `SIN_COBRO` / `SIN_SALDO` no son errores. */
  refund(request: RefundRequestDto): Promise<RefundResultDto> {
    return this.call('refund', request);
  }

  list(filters: { estado?: RefundStatus; desde?: string; hasta?: string; limit?: number; offset?: number } = {}): Promise<{ total: number; items: RefundDto[] }> {
    return this.call('list', filters);
  }

  get(code: string): Promise<RefundDto> {
    return this.call('get', { codigo: code });
  }

  listByOrder(orderId: string): Promise<RefundDto[]> {
    return this.call('listByOrder', { orden_id: orderId });
  }

  listByPayments(paymentIds: string[]): Promise<PaymentRefundsDto[]> {
    return this.call('listByPayments', { pago_ids: paymentIds });
  }
}
