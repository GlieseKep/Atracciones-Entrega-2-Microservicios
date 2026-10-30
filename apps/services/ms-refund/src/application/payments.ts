import { AppError, asService, type EsbClient } from '@atracciones/platform';

/** Pago de Payment (`GET /pagos/clave/:clave`). */
export interface PaymentInfo {
  pago_id: string;
  orden_id: string;
  estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'ANULADO';
  monto: number;
  moneda: string;
  referencia_pasarela: string | null;
}

/** Lo que Refund necesita de Payment. */
export interface PaymentLookup {
  /** `null` si no hay un pago con esa clave. */
  findByKey(paymentKey: string): Promise<PaymentInfo | null>;
  /** Anula un pago PENDIENTE (idempotente en Payment). */
  voidPayment(paymentKey: string): Promise<void>;
}

const paymentUnavailable = () =>
  new AppError(503, 'PAYMENT_UNAVAILABLE', 'No se pudo consultar el pago para calcular el saldo. Reintente con la misma clave.');

/**
 * Payment por el ESB con la cuenta de servicio de Refund (las dos rutas son internas). 404 → `null`; cualquier otra
 * falla → 503 `PAYMENT_UNAVAILABLE` sin haber guardado nada, para que la saga reintente.
 */
export function esbPaymentLookup(esb: EsbClient, internalTokenSecret: string): PaymentLookup {
  const asRefund = <T>(work: () => Promise<T>) => asService('refund', internalTokenSecret, work);
  return {
    async findByKey(paymentKey) {
      try {
        return await asRefund(() => esb.call<PaymentInfo>('payment', 'getPaymentByKey', { clave: paymentKey }, { timeoutMs: 2500 }));
      } catch (error) {
        if (error instanceof AppError && error.status === 404) return null;
        throw paymentUnavailable();
      }
    },
    async voidPayment(paymentKey) {
      try {
        await asRefund(() => esb.call('payment', 'voidPayment', { clave_idempotencia: paymentKey }, { timeoutMs: 2500 }));
      } catch {
        throw paymentUnavailable();
      }
    },
  };
}
