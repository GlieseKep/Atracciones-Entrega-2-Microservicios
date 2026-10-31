import type { CreatePurchaseRequest, PurchaseResponse } from '@/types/purchase';
import { http } from './client';

/** Compra directa sin carrito: el servidor calcula el precio y, con `paymentMethod`, procesa el pago simulado. */
export const createPurchase = (attractionId: string, body: CreatePurchaseRequest, idempotencyKey: string) =>
  http.post<PurchaseResponse>(`/attractions/${attractionId}/purchase`, body, { idempotencyKey });
