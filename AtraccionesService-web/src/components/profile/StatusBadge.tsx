import { Badge, type BadgeTone } from '@/components/common/Badge';

/** Etiquetas de estado. Aceptan cualquier texto: el panel administrativo aún usa los estados del monolito. */

const RESERVATION: Record<string, [string, BadgeTone]> = {
  PENDING: ['Pendiente de pago', 'warning'],
  CONFIRMED: ['Confirmada', 'success'],
  CHECKED_IN: ['Check-in hecho', 'success'],
  COMPLETED: ['Completada', 'neutral'],
  CANCELLED: ['Cancelada', 'danger'],
  EXPIRED: ['Vencida', 'danger'],
};

const ORDER: Record<string, [string, BadgeTone]> = {
  CREADA: ['Creada', 'warning'],
  PAGADA: ['Pagada', 'success'],
  CANCELADA: ['Cancelada', 'danger'],
  REEMBOLSADA: ['Reembolsada', 'neutral'],
  PENDING_PAYMENT: ['Pendiente de pago', 'warning'],
  PAID: ['Pagado', 'success'],
  FULFILLED: ['Completado', 'success'],
  CANCELLED: ['Cancelado', 'danger'],
  PARTIALLY_REFUNDED: ['Reembolso parcial', 'neutral'],
  REFUNDED: ['Reembolsado', 'neutral'],
};

const PAYMENT: Record<string, [string, BadgeTone]> = {
  PENDING: ['Pendiente', 'warning'],
  AUTHORIZED: ['Autorizado', 'success'],
  SETTLED: ['Liquidado', 'success'],
  REJECTED: ['Rechazado', 'danger'],
  FAILED: ['Fallido', 'danger'],
  CANCELLED: ['Cancelado', 'danger'],
  PARTIALLY_REFUNDED: ['Reembolso parcial', 'neutral'],
  REFUNDED: ['Reembolsado', 'neutral'],
};

export const reservationStatusLabel = (s: string) => RESERVATION[s]?.[0] ?? s;

export function ReservationStatusBadge({ status }: { status: string }) {
  const [label, tone] = RESERVATION[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function OrderStatusBadge({ status }: { status: string }) {
  const [label, tone] = ORDER[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const [label, tone] = PAYMENT[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}
