import { AppError, type EsbClient } from '@atracciones/platform';
import type { ReembolsoDto, ReembolsoInput } from '../contract';
import type { ApprovedPayment, RefundRepository } from '../persistence/refund-repository';

interface Payment {
  id: number;
  estado: string;
  monto: number;
}

const keyReused = () => AppError.conflict('IDEMPOTENCY_KEY_REUSED', 'La clave ya se usó con otra solicitud.');

export class RefundService {
  constructor(
    private readonly refunds: RefundRepository,
    private readonly esb: EsbClient,
  ) {}

  /** Nunca se reembolsa sin conocer el monto cobrado. */
  private async approvedPayment(ordId: number): Promise<ApprovedPayment> {
    let payments: Payment[];
    try {
      payments = await this.esb.call<Payment[]>('payment', 'listOrderPayments', { ordId });
    } catch (error) {
      if (error instanceof AppError && error.status >= 500) throw new AppError(503, 'PAYMENT_UNAVAILABLE', 'No se pudo consultar el monto cobrado.');
      throw error;
    }
    const approved = payments.find((payment) => payment.estado === 'APROBADO');
    if (!approved) throw AppError.conflict('NO_APPROVED_PAYMENT', `La orden ${ordId} no tiene un pago aprobado.`);
    return { id: approved.id, monto: approved.monto };
  }

  /** La misma clave con los mismos datos responde el mismo reembolso, sin depender de Payment si no hace falta. */
  private assertSameRequest(existing: ReembolsoDto, input: ReembolsoInput, pagId: number | null): void {
    if (input.monto !== null && input.monto !== existing.monto_reembolsado) throw keyReused();
    if (pagId !== null && pagId !== existing.pag_id) throw keyReused();
  }

  async emit(input: ReembolsoInput, clave: string): Promise<{ refund: ReembolsoDto; created: boolean }> {
    const existing = await this.refunds.findByKey(clave);
    if (existing) {
      const payment = await this.approvedPayment(input.ord_id).catch(() => null);
      this.assertSameRequest(existing, input, payment?.id ?? null);
      return { refund: { ...existing, ord_id: input.ord_id }, created: false };
    }
    const payment = await this.approvedPayment(input.ord_id);
    const refund = await this.refunds.emit(payment, input, clave);
    if (refund) return { refund, created: true };
    const concurrent = (await this.refunds.findByKey(clave)) as ReembolsoDto;
    this.assertSameRequest(concurrent, input, payment.id);
    return { refund: { ...concurrent, ord_id: input.ord_id }, created: false };
  }
}
