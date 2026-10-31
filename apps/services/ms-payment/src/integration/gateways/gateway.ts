import type { MetodoCodigo } from '../../contract';

export interface ChargeRequest {
  numero: string;
  monto: number;
  /** Una transferencia no la conoce: Payment no guarda la moneda. */
  moneda: string | null;
  metodo: MetodoCodigo;
  /** Solo con tarjeta. */
  ultimos4: string | null;
  /** Solo con transferencia. */
  comprobante: string | null;
}

/** Pasarela de cobro. Responde después, por su webhook, como lo haría una pasarela. */
export interface PaymentGateway {
  charge(request: ChargeRequest): void;
}
