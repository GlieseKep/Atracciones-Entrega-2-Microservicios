import { AppError, type Logger } from '@atracciones/platform';
import type { PagoDto, PagoInput, PaymentResult } from '../contract';
import type { PaymentGateway } from '../integration/gateways/gateway';
import type { PaymentRepository } from '../persistence/payment-repository';

export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGateway,
    private readonly logger: Logger,
  ) {}

  async get(id: number): Promise<PagoDto> {
    const payment = await this.payments.findById(id);
    if (!payment) throw AppError.notFound(`No existe el pago ${id}.`, 'PAYMENT_NOT_FOUND');
    return payment;
  }

  /** La pasarela se llama después de confirmar la transacción. Las transferencias esperan el comprobante. */
  async register(input: PagoInput): Promise<{ payment: PagoDto; created: boolean }> {
    const result = await this.payments.create(input);
    if (result.created && input.canal === 'WEB' && input.metodo !== 'TRANSFER') {
      this.gateway.charge({ numero: input.numero, monto: input.monto, moneda: input.moneda, metodo: input.metodo, ultimos4: input.tarjeta?.ultimos4 ?? null });
    }
    return result;
  }

  async cancel(id: number): Promise<PagoDto> {
    const payment = await this.payments.cancel(id);
    if (!payment) throw AppError.notFound(`No existe el pago ${id}.`, 'PAYMENT_NOT_FOUND');
    return payment;
  }

  /**
   * Un segundo aprobado de la misma orden no se acepta: queda `FALLIDO` y se registra para devolverlo con Refund.
   * Un resultado tardío sobre un pago en estado final se ignora.
   */
  async applyResult(id: number, result: PaymentResult): Promise<PagoDto | null> {
    try {
      const { payment, applied } = await this.payments.applyResult(id, result);
      if (!applied) this.logger.warn('resultado ignorado: el pago ya está en un estado final', { pag_id: id });
      return payment;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'PAYMENT_ALREADY_APPROVED') throw error;
      await this.payments.markFailed(id);
      this.logger.error('pago aprobado dos veces: hay que devolverlo con Refund', { pag_id: id });
      return this.payments.findById(id);
    }
  }
}
