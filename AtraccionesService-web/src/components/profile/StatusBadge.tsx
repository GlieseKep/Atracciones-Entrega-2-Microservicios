import { Badge, type BadgeTone } from '@/components/common/Badge';

/** Etiquetas de los estados de cada servicio. Un estado desconocido se muestra con su código. */

const RESERVATION: Record<string, [string, BadgeTone]> = {
  PENDING: ['Pendiente de pago', 'warning'],
  CONFIRMED: ['Confirmada', 'success'],
  CHECKED_IN: ['Check-in hecho', 'success'],
  COMPLETED: ['Completada', 'neutral'],
  CANCELLED: ['Cancelada', 'cancelled'],
  EXPIRED: ['Vencida', 'cancelled'],
};

const ORDER: Record<string, [string, BadgeTone]> = {
  CREADA: ['Creada', 'warning'],
  PAGADA: ['Pagada', 'success'],
  CANCELADA: ['Cancelada', 'danger'],
  REEMBOLSADA: ['Reembolsada', 'neutral'],
};

const PAYMENT: Record<string, [string, BadgeTone]> = {
  PENDIENTE: ['Pendiente', 'warning'],
  APROBADO: ['Aprobado', 'success'],
  RECHAZADO: ['Rechazado', 'danger'],
  FALLIDO: ['Fallido', 'danger'],
};

export const reservationStatusLabel = (s: string) => RESERVATION[s]?.[0] ?? s;

export function ReservationStatusBadge({ status }: { status: string }) {
  const [label, tone] = RESERVATION[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

/** En el panel los nombres son los que pidió Booking para el Flujo 2. La API y el portal del cliente no cambian. */
const ADMIN_RESERVATION: Record<string, [string, BadgeTone]> = {
  CONFIRMED: ['RESERVADO · pendiente de asistencia', 'warning'],
  CHECKED_IN: ['CONFIRMADO_ASISTIDO', 'success'],
};

export const adminReservationStatusLabel = (s: string) => ADMIN_RESERVATION[s]?.[0] ?? reservationStatusLabel(s);

export function AdminReservationStatusBadge({ status }: { status: string }) {
  const [label, tone] = ADMIN_RESERVATION[status] ?? RESERVATION[status] ?? [status, 'neutral'];
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
