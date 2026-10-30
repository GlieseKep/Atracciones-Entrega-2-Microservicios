import { randomBytes } from 'node:crypto';

/** Resultado de pedir la devolución a la pasarela. */
export type GatewayResult = { ok: true; reference: string } | { ok: false; reason: string };

/** Pasarela de pagos para devoluciones. Hoy no hay una real: la simulada aprueba todo al instante. */
export interface RefundGateway {
  refund(request: { refundCode: string; gatewayPaymentReference: string | null; amount: number; currency: string }): Promise<GatewayResult>;
}

/** Igual que hasta ahora en Payment: el reembolso se emite en el acto, con una referencia generada. */
export const simulatedRefundGateway: RefundGateway = {
  async refund() {
    return { ok: true, reference: `RFN-${randomBytes(6).toString('hex').toUpperCase()}` };
  },
};
