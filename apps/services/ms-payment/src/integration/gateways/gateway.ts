import type { MetodoCodigo } from '../../contract';

export interface ChargeRequest {
  numero: string;
  monto: number;
  moneda: string;
  metodo: MetodoCodigo;
  /** Solo con tarjeta. */
  ultimos4: string | null;
}

/** Pasarela de cobro. Responde después, por su webhook, como lo haría una pasarela. */
export interface PaymentGateway {
  charge(request: ChargeRequest): void;
}
