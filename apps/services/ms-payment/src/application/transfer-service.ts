import { AppError, hasRole, type EsbClient, type Principal } from '@atracciones/platform';
import type { PagoDto, TransferenciaInput } from '../contract';
import type { PaymentRepository } from '../persistence/payment-repository';
import type { PaymentService } from './payment-service';

const conflict = (code: string, message: string) => AppError.conflict(code, message);

/** Transferencias: el cliente envía el comprobante y un `ADMIN` lo aprueba o rechaza. La orden espera mientras tanto. */
export class TransferService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly service: PaymentService,
    private readonly esb: EsbClient,
  ) {}

  private assertPendingTransfer(payment: PagoDto): void {
    if (payment.metodo !== 'TRANSFER') throw conflict('PAYMENT_NOT_TRANSFER', 'El pago no es una transferencia.');
    if (payment.estado !== 'PENDIENTE') throw conflict('PAYMENT_NOT_PENDING', 'El pago ya no está pendiente.');
  }

  /** Payment no sabe de quién es la orden: lo responde Order. */
  private async assertOwner(payment: PagoDto, principal: Principal): Promise<void> {
    if (hasRole(principal, 'ADMIN')) return;
    const order = await this.esb.call<{ usu_id?: number }>('order', 'getOrder', { ord_id: payment.ord_id });
    if (Number(order.usu_id) !== Number(principal.id)) throw AppError.forbidden('El pago pertenece a otro usuario.');
  }

  async submit(id: number, input: TransferenciaInput, principal: Principal): Promise<PagoDto> {
    const payment = await this.service.get(id);
    await this.assertOwner(payment, principal);
    this.assertPendingTransfer(payment);
    if (!(await this.payments.saveTransfer(id, input))) throw conflict('TRANSFER_ALREADY_SENT', 'El comprobante ya se envió.');
    return payment;
  }

  async verify(id: number, aprobado: boolean, motivo: string): Promise<PagoDto> {
    this.assertPendingTransfer(await this.service.get(id));
    const comprobante = await this.payments.transferReceipt(id);
    if (!comprobante) throw conflict('TRANSFER_RECEIPT_MISSING', 'El pago todavía no tiene comprobante.');
    const result = aprobado ? ({ aprobado: true, referencia: comprobante, autorizacion: null } as const) : ({ aprobado: false, motivo } as const);
    return (await this.service.applyResult(id, result)) as PagoDto;
  }
}
