import { Link } from 'react-router-dom';
import { adminApi, type AdminPayment, type AdminReservation } from '@/api/admin';
import { OrderStatusBadge, PaymentStatusBadge, ReservationStatusBadge } from '@/components/profile/StatusBadge';
import { formatDate, formatDateTime } from '@/utils/dates';
import { formatMoney, shortCode } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { AdminTable, Sub, type Column } from './AdminTable';

const RESERVATION_STATUSES = [
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'PENDING', label: 'Pendiente' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

const PAYMENT_STATUSES = [
  { value: 'SETTLED', label: 'Liquidado' },
  { value: 'AUTHORIZED', label: 'Autorizado' },
  { value: 'PENDING', label: 'Pendiente' },
  { value: 'REJECTED', label: 'Rechazado' },
  { value: 'FAILED', label: 'Fallido' },
  { value: 'CANCELLED', label: 'Cancelado' },
  { value: 'PARTIALLY_REFUNDED', label: 'Reembolso parcial' },
  { value: 'REFUNDED', label: 'Reembolsado' },
];

const reservationColumns: Column<AdminReservation>[] = [
  { header: 'Código', cell: (r) => <span className="font-mono text-xs">{shortCode(r.id)}</span> },
  {
    header: 'Atracción',
    cell: (r) => (
      <Link to={paths.attraction(r.attractionId)} className="font-semibold hover:underline">
        {r.attractionName}
      </Link>
    ),
  },
  { header: 'Cliente', cell: (r) => <>{r.customerName}<Sub>{r.customerEmail}</Sub></> },
  { header: 'Visita', cell: (r) => <>{formatDate(r.date)}<Sub>{r.time}</Sub></> },
  { header: 'Entradas', cell: (r) => r.ticketCount, align: 'right' },
  { header: 'Total', cell: (r) => formatMoney(r.total.amount, r.total.currency), align: 'right' },
  {
    header: 'Estado',
    cell: (r) => (
      <>
        <ReservationStatusBadge status={r.status} />
        {r.cancellationReason && <Sub>{r.cancellationReason}</Sub>}
      </>
    ),
  },
  {
    header: 'Origen',
    cell: (r) =>
      r.orderId ? (
        <>
          <OrderLink orderId={r.orderId} label={`Compra · ${shortCode(r.orderId)}`} />
          {r.orderStatus && <OrderStatusBadge status={r.orderStatus} />}
        </>
      ) : (
        <span className="text-ink-muted">Reserva sin pago</span>
      ),
  },
  { header: 'Creada', cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt)}</span> },
];

/** Abre el detalle del pedido en la sección Pedidos. */
const OrderLink = ({ orderId, label }: { orderId: string; label: string }) => (
  <Link to={`/admin/pedidos?pedido=${orderId}`} className="block font-mono text-xs font-semibold text-brand-600 hover:underline">
    {label}
  </Link>
);

/** Reservas de todos los clientes (incluidas las que genera la compra directa). */
export function AdminReservationsPage() {
  return (
    <AdminTable
      title="Reservas"
      load={adminApi.reservations}
      columns={reservationColumns}
      rowKey={(r) => r.id}
      searchPlaceholder="Cliente, correo o atracción"
      statuses={RESERVATION_STATUSES}
      dateLabel="Visita"
    />
  );
}

const paymentColumns: Column<AdminPayment>[] = [
  { header: 'Referencia', cell: (p) => <span className="font-mono text-xs">{p.gatewayReference}</span> },
  { header: 'Pedido', cell: (p) => <OrderLink orderId={p.orderId} label={shortCode(p.orderId)} /> },
  { header: 'Cliente', cell: (p) => p.customerEmail },
  { header: 'Método', cell: (p) => (p.paymentMethod === 'CARD' ? 'Tarjeta' : 'Transferencia') },
  { header: 'Importe', cell: (p) => formatMoney(p.amount.amount, p.amount.currency), align: 'right' },
  { header: 'Intentos', cell: (p) => p.attempts, align: 'right' },
  {
    header: 'Estado',
    cell: (p) => (
      <>
        <PaymentStatusBadge status={p.status} />
        {p.failureReason && <Sub>{p.failureReason}</Sub>}
      </>
    ),
  },
  { header: 'Fecha', cell: (p) => <span className="text-xs">{formatDateTime(p.processedAt ?? p.createdAt)}</span> },
];

/** Simulaciones de pago. No hay datos de tarjeta: solo la referencia simulada. */
export function AdminPaymentsPage() {
  return (
    <AdminTable
      title="Pagos"
      load={adminApi.payments}
      columns={paymentColumns}
      rowKey={(p) => p.id}
      searchPlaceholder="Correo, referencia o pedido"
      statuses={PAYMENT_STATUSES}
      dateLabel="Fecha"
    />
  );
}
