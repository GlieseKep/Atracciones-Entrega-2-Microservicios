import type { IsoDate, IsoDateTime, Price } from './api';
import type { OrderStatus } from './order';
import type { PaymentMethod, PaymentSummary } from './payment';

/** Compra directa (POST /attractions/{attractionId}/purchase). El precio lo calcula el servidor. */
export interface CreatePurchaseRequest {
  date: IsoDate;
  time: string;
  quantity: number;
  paymentMethod?: PaymentMethod;
}

export interface PurchaseResponse {
  purchaseId: string;
  orderId: string;
  attractionId: string;
  date: IsoDate;
  time: string;
  quantity: number;
  unitPrice: Price;
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  reservationId?: string | null;
  payment?: PaymentSummary | null;
  holdExpiresAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}
