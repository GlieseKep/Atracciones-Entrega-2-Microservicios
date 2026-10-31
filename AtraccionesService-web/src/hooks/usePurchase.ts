import { useCallback } from 'react';
import { createPurchase } from '@/api/purchases';
import { simulatePayment } from '@/api/payments';
import type { CreatePurchaseRequest, PurchaseResponse } from '@/types/purchase';
import type { CreatePaymentSimulationRequest, PaymentSimulation } from '@/types/payment';
import { useIdempotentMutation } from './useReservations';

/**
 * Compra directa en dos operaciones lógicas:
 * 1. `POST /attractions/{id}/purchase` sin método de pago → pedido PENDING_PAYMENT con precio del servidor.
 * 2. `POST /payments/simulations` con el importe confirmado → resultado de la simulación.
 */
export function usePurchase(attractionId: string) {
  const confirm = useIdempotentMutation<CreatePurchaseRequest, PurchaseResponse>(
    useCallback((body, key) => createPurchase(attractionId, body, key), [attractionId]),
  );
  const pay = useIdempotentMutation<CreatePaymentSimulationRequest, PaymentSimulation>(
    useCallback((body, key) => simulatePayment(body, key), []),
  );
  return { confirm, pay };
}
