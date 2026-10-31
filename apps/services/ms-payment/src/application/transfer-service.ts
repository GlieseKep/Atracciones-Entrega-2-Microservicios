import { AppError, type EsbClient, type Principal } from '@atracciones/platform';
import type { PagoDto, TransferenciaInput } from '../contract';
import type { PaymentGateway } from '../integration/gateways/gateway';
import type { PaymentRepository } from '../persistence/payment-repository';
import type { PaymentService } from './payment-service';

const conflict = (code: string, message: string) => AppError.conflict(code, message);

/** Transferencias: el cliente envía el comprobante y la pasarela lo valida, a cualquier hora. Nadie las aprueba a mano. */
export class TransferService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly service: PaymentService,
    private readonly gateway: PaymentGateway,
    private readonly esb: EsbClient,
  ) {}

  /** Payment no sabe de quién es la orden: lo responde Order. */
  private async assertOwner(payment: PagoDto, principal: Principal): Promise<void> {
    const order = await this.esb.call<{ usu_id?: number }>('order', 'getOrder', { ord_id: payment.ord_id });
    if (Number(order.usu_id) !== Number(principal.id)) throw AppError.forbidden('El pago pertenece a otro usuario.');
  }

  /** La pasarela se llama después de guardar el comprobante, y responde por el webhook, como con las tarjetas. */
  async submit(id: number, input: TransferenciaInput, principal: Principal): Promise<PagoDto> {
    const payment = await this.service.get(id);
    await this.assertOwner(payment, principal);
    if (payment.metodo !== 'TRANSFER') throw conflict('PAYMENT_NOT_TRANSFER', 'El pago no es una transferencia.');
    if (payment.estado !== 'PENDIENTE') throw conflict('PAYMENT_NOT_PENDING', 'El pago ya no está pendiente.');
    if (!(await this.payments.saveTransfer(id, input))) throw conflict('TRANSFER_ALREADY_SENT', 'El comprobante ya se envió.');
    this.gateway.charge({ numero: payment.numero, monto: payment.monto, moneda: null, metodo: payment.metodo, ultimos4: null, comprobante: input.numero_comprobante });
    return payment;
  }
}
