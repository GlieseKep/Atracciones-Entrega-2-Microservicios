import type { IsoDateTime } from './api';

/** Pasarela simulada: nunca se envían ni muestran datos de tarjeta. */
export type PaymentMethod = 'CARD' | 'BANK_TRANSFER';

export type PaymentSimulationStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'SETTLED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export interface PaymentSummary {
  id: string;
  paymentMethod: PaymentMethod;
  status: PaymentSimulationStatus;
  gatewayReference?: string | null;
}

export interface CreatePaymentSimulationRequest {
  orderId: string;
  paymentMethod: PaymentMethod;
  amount: number;
  currency: string;
}

export interface PaymentSimulation {
  id: string;
  orderId: string;
  paymentMethod: PaymentMethod;
  status: PaymentSimulationStatus;
  amount: number;
  currency: string;
  gatewayReference?: string | null;
  createdAt: IsoDateTime;
}
