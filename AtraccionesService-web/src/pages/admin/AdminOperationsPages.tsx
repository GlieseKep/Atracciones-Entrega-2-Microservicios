import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { operationsApi } from '@/api/admin';
import { Badge, type BadgeTone } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { AdminReservationStatusBadge, PaymentStatusBadge } from '@/components/profile/StatusBadge';
import { useIdempotentMutation } from '@/hooks/useReservations';
import { useUiStore } from '@/stores/uiStore';
import type { Payment, PaymentState } from '@/types/admin';
import type { BookingNotificationStatus, CheckinResult, PaymentMethodCode, Reservation, ReservationStatus } from '@/types/booking';
import { errorMessage } from '@/utils/api';
import { formatDate, formatDateTime, isCheckinDay } from '@/utils/dates';
import { describeTickets, formatMoney } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { AdminTable, Sub, type Column } from './AdminTable';
import { CheckinForm } from './CheckinForm';

const RESERVATION_STATES: { value: ReservationStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pendientes de pago' },
  { value: 'CONFIRMED', label: 'Reservado · pendiente de asistencia' },
  { value: 'CHECKED_IN', label: 'Confirmado asistido' },
  { value: 'COMPLETED', label: 'Completadas' },
  { value: 'CANCELLED', label: 'Canceladas' },
  { value: 'EXPIRED', label: 'Vencidas' },
];

const NOTICE: Record<BookingNotificationStatus, [string, BadgeTone]> = {
  NO_APLICA: ['—', 'neutral'],
  PENDIENTE: ['Pendiente', 'warning'],
  ENVIADA: ['Enviado', 'success'],
  FALLIDA: ['Fallido', 'danger'],
};

const METHOD_LABEL: Record<PaymentMethodCode, string> = { CREDIT_CARD: 'Tarjeta de crédito', DEBIT_CARD: 'Tarjeta de débito', PAYPAL: 'PayPal', TRANSFER: 'Transferencia' };

/** El aviso a Booking sale en segundo plano: unos segundos después ya se sabe si se envió. */
const NOTICE_REFRESH_MS = 4000;

/**
 * Reservas de Booking (todas, rol ADMIN). Cualquiera se cancela aquí antes del check-in (reembolso del 100 % y cupos de vuelta);
 * el check-in solo se confirma el día del turno.
 */
export function AdminReservationsPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [checkingIn, setCheckingIn] = useState<Reservation | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const onCheckedIn = (result: CheckinResult) => {
    setCheckingIn(null);
    setReload((n) => n + 1);
    notify(`Asistencia de ${result.titular_nombre} confirmada.`, 'success');
    if (result.notificacion_booking === 'PENDIENTE') {
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setReload((n) => n + 1), NOTICE_REFRESH_MS);
    }
  };

  const columns: Column<Reservation>[] = [
    {
      header: 'Reserva',
      cell: (r) => (
        <Link to={paths.reservation(r.reservation_id)} className="font-semibold hover:underline">
          {r.reservation_code}
          <Sub>Orden {r.external_order_id}</Sub>
        </Link>
      ),
    },
    {
      header: 'Experiencia',
      cell: (r) => (
        <span>
          {r.attraction_id ? (
            <Link to={paths.attraction(r.attraction_id)} className="hover:underline">
              {r.attraction_name || r.attraction_id}
            </Link>
          ) : (
            r.attraction_name || '—'
          )}
          <Sub>
            {formatDate(r.date)} · {r.time}
          </Sub>
        </span>
      ),
    },
    { header: 'Titular', cell: (r) => <span>{r.customer.full_name}<Sub>{r.customer.document_type} {r.customer.document_id}</Sub></span> },
    { header: 'Boletos', cell: (r) => describeTickets({ adult: r.adult_count, child: r.child_count, senior: r.senior_count, infant: r.infant_count }) },
    { header: 'Guía', cell: (r) => r.guia_asignado },
    { header: 'Total', align: 'right', cell: (r) => formatMoney(r.total_price, r.currency) },
    { header: 'Estado', cell: (r) => <AdminReservationStatusBadge status={r.status} /> },
    {
      header: 'Booking',
      cell: (r) => {
        const [label, tone] = NOTICE[r.notificacion_booking ?? 'NO_APLICA'];
        return r.client_id ? (
          <span>
            <Badge tone={tone}>Aviso: {label}</Badge>
            <Sub>Turista {r.client_id}</Sub>
          </span>
        ) : (
          <span className="text-ink-muted">Web</span>
        );
      },
    },
    {
      header: '',
      align: 'right',
      cell: (r) => (
        <span className="inline-flex flex-wrap justify-end gap-2">
          {r.status === 'CONFIRMED' && isCheckinDay(r.date) && (
            <Button size="sm" onClick={() => setCheckingIn(r)}>
              Confirmar Asistencia
            </Button>
          )}
          {(r.status === 'PENDING' || r.status === 'CONFIRMED') && (
            <Button size="sm" variant="danger" onClick={() => setCancelling(r)}>
              Cancelar
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Reservas"
        load={(p, signal) => operationsApi.reservations({ page: p.page, limit: Math.min(p.limit, 50), estado: (p.status as ReservationStatus | '') ?? '', q: p.search }, signal)}
        columns={columns}
        rowKey={(r) => r.reservation_id}
        searchPlaceholder="Código, cédula o correo"
        statuses={RESERVATION_STATES}
        reloadKey={reload}
      />
      {checkingIn && (
        <Modal open onClose={() => setCheckingIn(null)} title={`Confirmar asistencia · ${checkingIn.reservation_code}`}>
          <p className="text-ink-soft">
            {checkingIn.customer.full_name} · {formatDate(checkingIn.date)} · {checkingIn.time} · {checkingIn.ticket_count} boletos
          </p>
          <CheckinForm reservation={checkingIn} onDone={onCheckedIn} />
        </Modal>
      )}
      {cancelling && (
        <CancelReservationDialog
          reservation={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function CancelReservationDialog({ reservation, onClose, onDone }: { reservation: Reservation; onClose: () => void; onDone: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [reason, setReason] = useState('');
  const { run, pending, error } = useIdempotentMutation<string, Reservation>(
    useCallback((text, key) => operationsApi.cancelReservation(reservation.reservation_id, text, key), [reservation.reservation_id]),
  );

  const submit = async () => {
    try {
      const updated = await run(reason.trim());
      const code = updated.refund?.refund_id || updated.cancel_code || updated.reembolso_id;
      notify(`Reserva ${updated.reservation_code} cancelada. Reembolso del 100 %${code ? ` (${code})` : ''}; los cupos quedaron liberados.`, 'success');
      onDone();
    } catch {
      /* se muestra abajo */
    }
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Cancelar ${reservation.reservation_code}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Volver
          </Button>
          <Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={submit}>
            Cancelar reserva
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-soft">
          Se anula la reserva, se reembolsa el 100 % del total y los cupos vuelven al turno.
        </p>
        <TextArea label="Motivo" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        {!!error && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}

const PAYMENT_STATES: { value: PaymentState; label: string }[] = [
  { value: 'PENDIENTE', label: 'Pendientes' },
  { value: 'APROBADO', label: 'Aprobados' },
  { value: 'RECHAZADO', label: 'Rechazados' },
  { value: 'FALLIDO', label: 'Fallidos' },
];

/** Pagos de ms-payment. Las transferencias pendientes se filtran con método Transferencia + estado Pendiente. */
export function AdminPaymentsPage() {
  const [metodo, setMetodo] = useState<PaymentMethodCode | ''>('');
  const columns: Column<Payment>[] = [
    { header: 'Pago', cell: (p) => <span className="font-semibold">{p.numero}<Sub>Orden #{p.ord_id}</Sub></span> },
    { header: 'Método', cell: (p) => METHOD_LABEL[p.metodo] ?? p.metodo },
    { header: 'Monto', align: 'right', cell: (p) => formatMoney(p.monto) },
    {
      header: 'Estado',
      cell: (p) => (
        <span>
          <PaymentStatusBadge status={p.estado} />
          {p.motivo_rechazo && <Sub>{p.motivo_rechazo}</Sub>}
        </span>
      ),
    },
    { header: 'Referencia', cell: (p) => <span className="font-mono text-xs">{p.referencia ?? p.autorizacion ?? '—'}</span> },
    { header: 'Fecha', cell: (p) => formatDateTime(p.fecha) },
  ];

  return (
    <AdminTable
      title="Pagos"
      load={(p, signal) => operationsApi.payments({ page: p.page, limit: p.limit, estado: (p.status as PaymentState | '') ?? '', metodo }, signal)}
      columns={columns}
      rowKey={(p) => String(p.id)}
      statuses={PAYMENT_STATES}
      extraFilters={
        <Select
          label="Método"
          value={metodo}
          onChange={(e) => setMetodo(e.target.value as PaymentMethodCode | '')}
          options={[{ value: '', label: 'Todos' }, ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))]}
        />
      }
      extraKey={metodo}
    />
  );
}
