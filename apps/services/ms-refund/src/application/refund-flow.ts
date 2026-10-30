import { randomBytes } from 'node:crypto';
import { createLogger, money, type Logger } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { RefundResultDto } from '../contract';
import type { RefundGateway } from '../integration/payment-gateway';
import type { RefundRepository } from '../persistence/refund-repository';
import type { PaymentLookup } from './payments';
import type { RefundRequest } from './refund-input';

/** `REF-ATR-XXXXXXXX`: el mismo formato que generaba Payment (`reembolso_id` del contrato v3). */
export const newRefundCode = () => `REF-ATR-${randomBytes(4).toString('hex').toUpperCase()}`;

const isUniqueViolation = (error: unknown) => (error as { driverError?: { code?: string } }).driverError?.code === '23505';

/**
 * Reembolso de un pago (la saga de cancelación de Order lo pide con su cuenta de servicio). Idempotente por
 * `clave_idempotencia` y sin superar nunca el monto cobrado:
 *
 * 1. Si la clave ya existe, devuelve lo guardado (sin llamar a Payment); si quedó PENDIENTE, lo termina.
 * 2. Consulta el pago en Payment. Si no está aprobado no hay nada que devolver (`SIN_COBRO`); si estaba pendiente, lo
 *    anula. Si Payment no responde, 503 sin guardar nada.
 * 3. Con el pago bloqueado: saldo = monto − comprometido (EMITIDO + PENDIENTE). Sin saldo → `SIN_SALDO`. Si hay,
 *    registra el reembolso en PENDIENTE (el monto queda comprometido).
 * 4. Pide la devolución a la pasarela y marca EMITIDO (con el evento `ReembolsoEmitido`) o FALLIDO.
 */
export class RefundFlow {
  private readonly logger: Logger;

  constructor(
    private readonly db: DataSource,
    private readonly refunds: RefundRepository,
    private readonly payments: PaymentLookup,
    private readonly gateway: RefundGateway,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger('ms-refund');
  }

  async refund(request: RefundRequest): Promise<RefundResultDto> {
    const saved = await this.refunds.byKey(request.idempotencyKey);
    if (saved?.estado === 'PENDIENTE') return this.resume(request.idempotencyKey, saved);
    if (saved) return saved;

    const payment = await this.payments.findByKey(request.paymentKey);
    if (!payment || payment.estado !== 'APROBADO') {
      // Solo se anula un pago PENDIENTE: la anulación de Payment también anularía uno aprobado.
      if (payment?.estado === 'PENDIENTE') await this.payments.voidPayment(request.paymentKey);
      return { reembolso_codigo: null, monto: 0, estado: 'SIN_COBRO' };
    }

    const code = newRefundCode();
    let reserved: RefundResultDto;
    try {
      reserved = await this.db.transaction(async (m) => {
        await this.refunds.lockPayment(m, payment.pago_id);
        const again = await this.refunds.byKey(request.idempotencyKey, m);
        if (again) return again;
        const balance = money(payment.monto - (await this.refunds.committed(m, payment.pago_id)));
        if (balance <= 0) return { reembolso_codigo: null, monto: 0, estado: 'SIN_SALDO' as const };
        const amount = money(Math.min(request.amount ?? balance, balance));
        await this.refunds.insertPending(m, {
          paymentId: payment.pago_id, orderId: payment.orden_id, code, amount, currency: payment.moneda,
          reason: request.reason, requester: request.requester, idempotencyKey: request.idempotencyKey,
        });
        return { reembolso_codigo: code, monto: amount, estado: 'PENDIENTE' as const };
      });
    } catch (error) {
      // Otro reintento con la misma clave ganó la carrera: se devuelve el suyo.
      if (isUniqueViolation(error)) {
        const winner = await this.refunds.byKey(request.idempotencyKey);
        if (winner) return winner;
      }
      throw error;
    }
    if (reserved.estado !== 'PENDIENTE' || reserved.reembolso_codigo !== code) return reserved;
    return this.settle(code, reserved.monto, payment.moneda, payment.pago_id, payment.referencia_pasarela);
  }

  /**
   * Un reintento encontró el reembolso en PENDIENTE (el proceso se cortó antes de terminar con la pasarela): se completa
   * con el monto ya comprometido. La pasarela recibe el mismo `refundCode`, así que no emite dos devoluciones.
   */
  private async resume(key: string, saved: RefundResultDto): Promise<RefundResultDto> {
    const pending = await this.refunds.pendingByKey(key);
    if (!pending) return (await this.refunds.byKey(key)) ?? saved;
    this.logger.warn('se retoma un reembolso que quedó pendiente', { reembolso: pending.code, pago_id: pending.paymentId });
    return this.settle(pending.code, pending.amount, pending.currency, pending.paymentId, null);
  }

  /** Pide la devolución a la pasarela y deja el reembolso EMITIDO (con su evento) o FALLIDO. */
  private async settle(code: string, amount: number, currency: string, paymentId: string, gatewayReference: string | null): Promise<RefundResultDto> {
    const result = await this.gateway.refund({ refundCode: code, gatewayPaymentReference: gatewayReference, amount, currency });
    if (result.ok) {
      await this.refunds.markIssued(code, result.reference);
      this.logger.info('reembolso emitido', { reembolso: code, pago_id: paymentId, monto: amount });
      return { reembolso_codigo: code, monto: amount, estado: 'EMITIDO' };
    }
    await this.refunds.markFailed(code);
    this.logger.warn('la pasarela rechazó el reembolso', { reembolso: code, pago_id: paymentId, motivo: result.reason });
    return { reembolso_codigo: code, monto: amount, estado: 'FALLIDO' };
  }
}
