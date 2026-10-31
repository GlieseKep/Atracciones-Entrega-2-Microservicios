import { Badge, type BadgeTone } from '@/components/common/Badge';
import type { OrderStatus } from '@/types/order';
import type { PaymentSimulationStatus } from '@/types/payment';
import type { ReservationStatus } from '@/types/reservation';

const RESERVATION: Record<ReservationStatus, [string, BadgeTone]> = {
  PENDING: ['Pendiente', 'warning'],
  CONFIRMED: ['Confirmada', 'success'],
  CANCELLED: ['Cancelada', 'danger'],
};

const ORDER: Record<OrderStatus, [string, BadgeTone]> = {
  PENDING_PAYMENT: ['Pendiente de pago', 'warning'],
  PAID: ['Pagado', 'success'],
  FULFILLED: ['Completado', 'success'],
  CANCELLED: ['Cancelado', 'danger'],
  PARTIALLY_REFUNDED: ['Reembolso parcial', 'neutral'],
  REFUNDED: ['Reembolsado', 'neutral'],
};

const PAYMENT: Record<PaymentSimulationStatus, [string, BadgeTone]> = {
  PENDING: ['Pendiente', 'warning'],
  AUTHORIZED: ['Autorizado', 'success'],
  SETTLED: ['Liquidado', 'success'],
  REJECTED: ['Rechazado', 'danger'],
  FAILED: ['Fallido', 'danger'],
  CANCELLED: ['Cancelado', 'danger'],
  PARTIALLY_REFUNDED: ['Reembolso parcial', 'neutral'],
  REFUNDED: ['Reembolsado', 'neutral'],
};

export const orderStatusLabel = (s: OrderStatus) => ORDER[s]?.[0] ?? s;

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  const [label, tone] = RESERVATION[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const [label, tone] = ORDER[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentSimulationStatus }) {
  const [label, tone] = PAYMENT[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}
