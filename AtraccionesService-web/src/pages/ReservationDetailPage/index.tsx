import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  MapPin,
  QrCode,
  Receipt,
  Ticket,
  User,
  Users,
} from 'lucide-react';
import { getReservation } from '@/api/bookings';
import { getAvailability } from '@/api/catalog';
import { getOrder, getOrderInvoice } from '@/api/orders';
import { Button, ButtonLink } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Badge } from '@/components/common/Badge';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { OrderStatusBadge, ReservationStatusBadge } from '@/components/profile/StatusBadge';
import { photoAt } from '@/features/content/photos';
import { useAsync } from '@/hooks/useAsync';
import { useAttraction } from '@/hooks/useAttractions';
import { useCancelReservation } from '@/hooks/useReservations';
import { useUiStore } from '@/stores/uiStore';
import type { Reservation } from '@/types/booking';
import type { OrderDetail } from '@/types/order';
import { errorMessage } from '@/utils/api';
import { formatDate, formatDateTime } from '@/utils/dates';
import { describeTickets, formatMoney, lineAttractionName } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { cancelReasonSchema, type CancelReasonValues } from '@/utils/validation';

/** Cualquier reserva antes del check-in (web o Booking): reembolso del 100 % y los cupos vuelven al turno. */
const NOT_CANCELLABLE = ['CHECKED_IN', 'COMPLETED', 'CANCELLED', 'EXPIRED'];
const canCancel = (r: Reservation) => !NOT_CANCELLABLE.includes(r.status);
const checkedIn = (r: Reservation) => r.status === 'CHECKED_IN' || r.status === 'COMPLETED';

const METHOD_LABEL: Record<string, string> = {
  CREDIT_CARD: 'Tarjeta de crédito',
  DEBIT_CARD: 'Tarjeta de débito',
  PAYPAL: 'PayPal',
  TRANSFER: 'Transferencia',
};

const TICKET_LABEL: Record<string, string> = {
  ADULT: 'Adulto',
  CHILD: 'Niño',
  SENIOR: 'Adulto mayor',
  INFANT: 'Infante',
  STUDENT: 'Estudiante',
};

/** Reserva de Booking con su orden (ms-order) y, si ya se emitió, la factura (ms-invoicing). */
export default function ReservationDetailPage() {
  const { reservationId = '' } = useParams();
  const reservation = useAsync((signal) => getReservation(reservationId, signal), [reservationId]);
  const ordNumero = reservation.data?.external_order_id;
  const order = useAsync(
    (signal) => getOrder(ordNumero!, signal),
    [ordNumero, reservation.data?.status],
    !!ordNumero,
  );
  // Ficha de la atracción (código público que devuelve Booking): foto y enlace.
  const attraction = useAttraction(reservation.data?.attraction_id || undefined);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelled, setCancelled] = useState<Reservation | null>(null);

  if (reservation.status === 'error') {
    return (
      <div className="page-container pt-10">
        <ErrorState error={reservation.error} onRetry={reservation.retry} />
      </div>
    );
  }
  if (!reservation.data) return <div className="page-container skeleton mt-10 h-80" aria-busy="true" />;

  const r = reservation.data;
  const attractionId = r.attraction_id || attraction.data?.id;
  const name =
    r.attraction_name ||
    attraction.data?.name ||
    (order.data?.lineas[0] ? lineAttractionName(order.data.lineas[0].descripcion) : 'Tu experiencia');
  const photo = attraction.data?.photos?.[0];

  return (
    <div className="page-container max-w-4xl pt-4">
      <Breadcrumbs
        items={[
          { label: 'Inicio', to: '/' },
          { label: 'Mis reservas', to: paths.profile('reservas') },
          { label: r.reservation_code },
        ]}
      />

      {r.status === 'CONFIRMED' && (
        <div className="mt-6 flex items-center gap-3 rounded-md bg-[#EEF7F2] p-4 text-success" role="status">
          <CheckCircle2 size={28} aria-hidden="true" />
          <p className="font-semibold">
            Tu compra está confirmada. Presenta el código QR y tu documento en el punto de encuentro.
          </p>
        </div>
      )}
      {r.status === 'PENDING' && (
        <Alert className="mt-6">
          Tu reserva está registrada y el pago está pendiente de confirmación. Los cupos quedan reservados
          mientras tanto.
        </Alert>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <section className="card-surface overflow-hidden">
            {photo && attractionId && (
              <Link to={paths.attraction(attractionId)} aria-hidden="true" tabIndex={-1}>
                <img src={photoAt(photo, 960)} alt="" className="h-48 w-full object-cover" />
              </Link>
            )}
            <div className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-ink-muted">Reserva {r.reservation_code}</p>
                  <h1 className="mt-1 text-2xl">
                    {attractionId ? (
                      <Link to={paths.attraction(attractionId)} className="hover:underline">
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </h1>
                  {attraction.data?.city && (
                    <p className="mt-1 text-sm text-ink-soft">{attraction.data.city}, Ecuador</p>
                  )}
                </div>
                <ReservationStatusBadge status={r.status} />
              </div>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                <li className="flex items-center gap-2">
                  <CalendarDays size={18} aria-hidden="true" />{' '}
                  {formatDate(r.date, { weekday: 'long', month: 'long' })}
                </li>
                <li className="flex items-center gap-2">
                  <Clock size={18} aria-hidden="true" /> {r.time}
                </li>
                <li className="flex items-center gap-2">
                  <Users size={18} aria-hidden="true" />
                  {describeTickets({
                    adult: r.adult_count,
                    child: r.child_count,
                    senior: r.senior_count,
                    infant: r.infant_count,
                  })}
                </li>
                <li className="flex items-center gap-2">
                  <Ticket size={18} aria-hidden="true" /> Total {formatMoney(r.total_price, r.currency)}
                </li>
                <li className="flex items-center gap-2">
                  <User size={18} aria-hidden="true" /> Guía: {r.guia_asignado}
                </li>
                {r.punto_encuentro && (
                  <li className="flex items-center gap-2">
                    <MapPin size={18} aria-hidden="true" /> {r.punto_encuentro}
                  </li>
                )}
              </ul>
              {(attractionId || canCancel(r) || checkedIn(r)) && (
                <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
                  {attractionId && (
                    <ButtonLink to={paths.attraction(attractionId)} variant="secondary">
                      Ver la experiencia <ArrowRight size={16} aria-hidden="true" />
                    </ButtonLink>
                  )}
                  {canCancel(r) && (
                    <Button variant="danger" onClick={() => setCancelOpen(true)}>
                      Cancelar reserva
                    </Button>
                  )}
                  {checkedIn(r) && (
                    <Badge tone="neutral" className="self-center px-3 py-1.5 text-sm">
                      <CheckCircle2 size={16} aria-hidden="true" /> Check-in realizado (Servicio iniciado, no cancelable)
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="card-surface p-6" aria-labelledby="holder-title">
            <h2 id="holder-title" className="text-lg">
              Titular
            </h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <Row label="Nombre" value={r.customer.full_name} />
              <Row label="Documento" value={`${r.customer.document_type} ${r.customer.document_id}`} />
              <Row label="Correo" value={r.customer.email} />
              <Row label="Teléfono" value={r.customer.phone} />
            </dl>
          </section>

          <OrderSection order={order} />
        </div>

        <aside className="space-y-4">
          {r.voucher_qr_payload && ['CONFIRMED', 'CHECKED_IN'].includes(r.status) && (
            <section className="card-surface p-5 text-center" aria-labelledby="voucher-title">
              <h2 id="voucher-title" className="flex items-center justify-center gap-2 text-lg">
                <QrCode size={18} aria-hidden="true" /> Voucher
              </h2>
              <p className="mt-2 text-3xl font-extrabold tracking-wider">{r.reservation_code}</p>
              <p className="mt-3 break-all rounded-sm bg-surface p-2 text-left font-mono text-[11px] text-ink-soft">
                {r.voucher_qr_payload}
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                El guía escanea este código en el check-in. También lo recibiste por correo.
              </p>
            </section>
          )}
          {order.data && <InvoiceCard order={order.data} />}
          <p className="text-sm text-ink-soft">
            ¿Necesitas ayuda? Consulta la{' '}
            <Link to={paths.help('cancelacion')} className="link">
              política de cancelación
            </Link>{' '}
            o{' '}
            <Link to={paths.help('contacto')} className="link">
              escríbenos
            </Link>
            .
          </p>
        </aside>
      </div>

      <CancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        reservationId={r.reservation_id}
        onCancelled={(updated) => {
          reservation.setData(updated);
          setCancelOpen(false);
          setCancelled(updated);
        }}
      />
      {cancelled && <CancelledDialog reservation={cancelled} onClose={() => setCancelled(null)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function OrderSection({ order }: { order: ReturnType<typeof useAsync<OrderDetail>> }) {
  if (order.status === 'error')
    return <ErrorState error={order.error} onRetry={order.retry} className="py-8" />;
  if (!order.data) return <div className="skeleton h-40" aria-busy="true" />;
  const { orden, lineas, metodo, fecha } = order.data;
  return (
    <section className="card-surface p-6" aria-labelledby="order-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="order-title" className="flex items-center gap-2 text-lg">
            <Receipt size={18} aria-hidden="true" /> Orden {orden.ord_numero}
          </h2>
          <p className="text-sm text-ink-soft">
            {formatDateTime(fecha)} · {METHOD_LABEL[metodo] ?? metodo}
          </p>
        </div>
        <OrderStatusBadge status={orden.estado} />
      </div>
      <ul className="mt-4 divide-y divide-line text-sm">
        {lineas.map((line) => (
          <li key={line.det_id} className="flex justify-between gap-3 py-2">
            <span>
              {TICKET_LABEL[line.ticket_type] ?? line.ticket_type} × {line.cantidad}{' '}
              <span className="text-ink-muted">({formatMoney(line.precio_unitario, orden.moneda)} c/u)</span>
            </span>
            <span className="font-semibold">{formatMoney(line.subtotal, orden.moneda)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        <Amount label="Subtotal" value={formatMoney(orden.subtotal, orden.moneda)} />
        {orden.descuento > 0 && (
          <Amount label="Descuento" value={`−${formatMoney(orden.descuento, orden.moneda)}`} />
        )}
        <Amount label="IVA" value={formatMoney(orden.iva, orden.moneda)} />
        <div className="flex justify-between pt-1 text-lg font-extrabold">
          <dt>Total</dt>
          <dd>{formatMoney(orden.total, orden.moneda)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-soft">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** La factura la emite Invoicing al pagarse la orden; si aún no existe (o no se puede consultar), no se muestra. */
function InvoiceCard({ order }: { order: OrderDetail }) {
  const invoice = useAsync(
    (signal) => getOrderInvoice(order.orden.ord_id, signal),
    [order.orden.ord_id, order.orden.estado],
  );
  if (!invoice.data) return null;
  const f = invoice.data;
  return (
    <section className="card-surface p-5" aria-labelledby="invoice-title">
      <h2 id="invoice-title" className="flex items-center gap-2 text-lg">
        <FileText size={18} aria-hidden="true" /> Factura
      </h2>
      <dl className="mt-3 space-y-2 text-sm">
        <Amount label="Número" value={f.numero} />
        <Amount label="Emitida" value={formatDateTime(f.emitida_en)} />
        <Amount label="A nombre de" value={f.razon_social} />
        <Amount
          label="SRI"
          value={
            f.estado_sri === 'AUTORIZADA'
              ? 'Autorizada'
              : f.estado_sri === 'RECHAZADA'
                ? 'Rechazada'
                : 'En proceso'
          }
        />
        <Amount label="Total" value={formatMoney(f.total)} />
      </dl>
      {f.autorizacion_sri && (
        <p className="mt-3 break-all font-mono text-[11px] text-ink-muted">
          Autorización {f.autorizacion_sri}
        </p>
      )}
    </section>
  );
}

function CancelDialog({
  open,
  onClose,
  reservationId,
  onCancelled,
}: {
  open: boolean;
  onClose: () => void;
  reservationId: string;
  onCancelled: (r: Reservation) => void;
}) {
  const { run, pending, error } = useCancelReservation(reservationId);
  const notify = useUiStore((s) => s.notify);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CancelReasonValues>({ resolver: zodResolver(cancelReasonSchema) });

  const submit = handleSubmit(async ({ reason }) => {
    try {
      const updated = await run(reason.trim());
      notify('Reserva cancelada y reembolsada. Los cupos quedaron liberados.', 'success');
      onCancelled(updated);
    } catch {
      /* se muestra abajo */
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancelar reserva"
      size="sm"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Mantener reserva
          </Button>
          <Button variant="danger" loading={pending} onClick={submit}>
            Confirmar cancelación
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-ink-soft">
          Esta acción no se puede deshacer: se anulará la reserva y se liberarán sus cupos en el turno para otros
          viajeros. Recibirás el reembolso del 100 % del total.
        </p>
        <TextArea label="Motivo de la cancelación" error={errors.reason?.message} {...register('reason')} />
        {!!error && <Alert tone="error">{errorMessage(error)}</Alert>}
      </form>
    </Modal>
  );
}

/** Resultado de la cancelación: comprobante del reembolso y cupos del turno consultados en ese momento (sin caché). */
function CancelledDialog({ reservation: r, onClose }: { reservation: Reservation; onClose: () => void }) {
  const code = r.refund?.refund_id || r.cancel_code || r.reembolso_id || '';
  const amount = r.refund?.amount ?? r.monto_reembolsado ?? r.total_price;
  const spots = r.stock_restoration?.restored_spots ?? r.ticket_count;
  const availability = useAsync(
    (signal) => getAvailability(r.attraction_id!, r.date, signal),
    [r.attraction_id, r.date],
    !!r.attraction_id,
  );
  const slot = availability.data?.time_slots.find((s) => s.time === r.time);

  return (
    <Modal open onClose={onClose} title="Reserva cancelada" size="sm" footer={<Button onClick={onClose}>Entendido</Button>}>
      <div className="space-y-4">
        <Badge tone="success" className="px-3 py-1.5 text-sm">
          <CheckCircle2 size={16} aria-hidden="true" /> ¡Cancelación y Reembolso Exitosos!
        </Badge>
        <dl className="grid gap-2 text-sm">
          <Row label="Código de Reembolso" value={code} />
          <Row label="Monto Reembolsado" value={`100 % (${formatMoney(amount, r.currency)})`} />
          <Row label="Stock Reincorporado" value={`✓ Cupos liberados (${spots})`} />
          {slot && <Row label="Cupos disponibles del turno" value={`${slot.available_slots} de ${slot.total_slots}`} />}
        </dl>
        {r.message && <p className="text-sm text-ink-soft">{r.message}</p>}
      </div>
    </Modal>
  );
}
