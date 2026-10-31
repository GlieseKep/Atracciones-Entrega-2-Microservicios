import type { IsoDate, IsoDateTime, Price } from './api';
import type { PaymentSummary } from './payment';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'FULFILLED'
  | 'CANCELLED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export interface OrderItem {
  id: string;
  attractionId: string;
  date: IsoDate;
  time: string;
  quantity: number;
  unitPrice: Price;
  status: string;
}

export interface Order {
  id: string;
  customerId: string;
  purchaseId?: string | null;
  reservationId?: string | null;
  status: OrderStatus;
  currency: string;
  totalAmount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  items: OrderItem[];
  paymentSimulation?: PaymentSummary | null;
}

export interface OrderEvent {
  eventType: string;
  previousStatus?: string | null;
  newStatus: string;
  createdAt: IsoDateTime;
}

export interface OrderEventsResponse {
  orderId: string;
  events: OrderEvent[];
}
