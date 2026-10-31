import type { EsbClient } from '@atracciones/platform';
import type { FacturaDetalle, FacturaPage } from '../contract';
import type { InvoicingOperation } from './esb-routes';

/** Cliente de Invoicing a través del ESB (operaciones de `MS_INVOICING_ROUTES`), para GraphQL. */
export class InvoicingClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'invoicing',
  ) {}

  private call<T>(operation: InvoicingOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  listInvoices(filters: { estado?: string; estado_sri?: string; page?: number; limit?: number } = {}): Promise<FacturaPage> {
    return this.call('listInvoices', filters);
  }

  getInvoice(id: number): Promise<FacturaDetalle> {
    return this.call('getInvoice', { id });
  }

  getOrderInvoice(ordId: number): Promise<FacturaDetalle> {
    return this.call('getOrderInvoice', { ordId });
  }
}
