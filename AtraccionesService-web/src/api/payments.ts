import type { CreatePaymentSimulationRequest, PaymentSimulation } from '@/types/payment';
import { http } from './client';

/** Solicita la simulación; el cliente nunca envía estados, intentos, eventos ni datos de tarjeta. */
export const simulatePayment = (body: CreatePaymentSimulationRequest, idempotencyKey: string) =>
  http.post<PaymentSimulation>('/payments/simulations', body, { idempotencyKey });
