import { todayIn, type EsbClient, type EventHandler, type Logger } from '@atracciones/platform';
import type { Issuer } from '../contract';
import type { InvoiceRepository } from '../persistence/invoice-repository';
import { accessKey, formatSequential, invoiceNumber } from './access-key';
import { resolveBuyer } from './buyer';
import { breakdown, type OrderLineInput } from './tax';

export const EVENT_QUEUE = 'ms-invoicing';
export const EVENT_PATTERNS = ['order.OrdenPagada', 'refund.ReembolsoEmitido'];

interface OrderDetail {
  orden: { descuento: number; total: number };
  usu_id: number;
  lineas: OrderLineInput[];
}

export interface InvoiceConfig {
  issuer: Issuer;
  ivaPorcentaje: number;
  correoDefecto: string;
}

/** Se factura únicamente con `OrdenPagada`, y a lo sumo una vez por orden. */
export class InvoiceService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly esb: EsbClient,
    private readonly config: InvoiceConfig,
    private readonly logger: Logger,
  ) {}

  private async emit(ordId: number): Promise<void> {
    if (await this.invoices.existsForOrder(ordId)) return;
    const order = await this.esb.call<OrderDetail>('order', 'getOrder', { ord_id: ordId });
    const buyer = await resolveBuyer(this.esb, Number(order.usu_id), this.config.correoDefecto);
    const data = breakdown(order.lineas, order.orden.descuento, this.config.ivaPorcentaje);
    if (Math.abs(data.total - order.orden.total) > 0.001) this.logger.error('el total de la factura no coincide con la orden', { ord_id: ordId, factura: data.total, orden: order.orden.total });
    const secuencial = formatSequential(await this.invoices.nextSequence());
    await this.invoices.create(ordId, invoiceNumber(secuencial), accessKey(this.config.issuer, todayIn(), secuencial), buyer, data);
  }

  eventHandler(): EventHandler {
    return async (event) => {
      const ordId = Number(event.data.ord_id);
      if (!Number.isSafeInteger(ordId) || ordId < 1) {
        this.logger.warn('evento descartado: sin ord_id', { event_id: event.id, type: event.type });
        return;
      }
      if (event.type === 'OrdenPagada') await this.emit(ordId);
      else if (event.type === 'ReembolsoEmitido') await this.invoices.annulIfRefunded(ordId, Number(event.data.monto_acumulado));
    };
  }
}
