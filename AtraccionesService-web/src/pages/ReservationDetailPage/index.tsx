import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, CheckCircle2, Clock, Ticket, Users } from 'lucide-react';
import { getReservation } from '@/api/reservations';
import { photoAt } from '@/components/attractions/AttractionCard';
import { Button, ButtonLink } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { ReservationStatusBadge } from '@/components/profile/StatusBadge';
import { useAsync } from '@/hooks/useAsync';
import { useAttraction } from '@/hooks/useAttractions';
import { useCancelReservation } from '@/hooks/useReservations';
import { useUiStore } from '@/stores/uiStore';
import { errorMessage } from '@/utils/api';
import { formatDate } from '@/utils/dates';
import { formatPrice, shortCode } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { cancelReasonSchema, type CancelReasonValues } from '@/utils/validation';

export default function ReservationDetailPage() {
  const { reservationId = '' } = useParams();
  const reservation = useAsync((signal) => getReservation(reservationId, signal), [reservationId]);
  const attraction = useAttraction(reservation.data?.attractionId);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (reservation.status === 'error') {
    return (
      <div className="page-container pt-10">
        <ErrorState error={reservation.error} onRetry={reservation.retry} />
      </div>
    );
  }
  if (!reservation.data) return <div className="page-container skeleton mt-10 h-80" aria-busy="true" />;

  const r = reservation.data;
  const a = attraction.data;

  return (
    <div className="page-container max-w-3xl pt-4">
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Mis reservas', to: paths.profile('reservas') }, { label: `#${shortCode(r.reservationId)}` }]} />

      {r.status === 'CONFIRMED' && (
        <div className="mt-6 flex items-center gap-3 rounded-md bg-[#EEF7F2] p-4 text-success">
          <CheckCircle2 size={28} aria-hidden="true" />
          <p className="font-semibold">Tu reserva está confirmada. ¡Prepárate para disfrutar!</p>
        </div>
      )}

      <div className="card-surface mt-6 overflow-hidden">
        {a?.photos[0] && <img src={photoAt(a.photos[0].url, 960)} alt="" className="h-48 w-full object-cover" />}
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-ink-muted">Reserva #{shortCode(r.reservationId)}</p>
              <h1 className="mt-1 text-2xl">{a?.name ?? 'Tu experiencia'}</h1>
            </div>
            <ReservationStatusBadge status={r.status} />
          </div>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            <li className="flex items-center gap-2">
              <CalendarDays size={18} aria-hidden="true" /> {formatDate(r.date, { weekday: 'long', month: 'long' })}
            </li>
            <li className="flex items-center gap-2">
              <Clock size={18} aria-hidden="true" /> {r.time} (hora local)
            </li>
            <li className="flex items-center gap-2">
              <Users size={18} aria-hidden="true" /> {r.ticketCount} {r.ticketCount === 1 ? 'entrada' : 'entradas'}
            </li>
            <li className="flex items-center gap-2">
              <Ticket size={18} aria-hidden="true" /> Total {formatPrice(r.totalPrice)}
            </li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
            {a && (
              <ButtonLink to={paths.attraction(a.id)} variant="secondary">
                Ver la experiencia
              </ButtonLink>
            )}
            {r.status !== 'CANCELLED' && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Cancelar reserva
              </Button>
            )}
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm text-ink-soft">
        ¿Necesitas ayuda? Consulta nuestra <Link to="/ayuda#cancelacion" className="link">política de cancelación</Link>.
      </p>

      <CancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        reservationId={r.reservationId}
        onCancelled={(updated) => {
          reservation.setData(updated);
          setCancelOpen(false);
        }}
      />
    </div>
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
  onCancelled: (r: Awaited<ReturnType<typeof getReservation>>) => void;
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
      notify('Reserva cancelada.', 'success');
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
        <p className="text-ink-soft">Esta acción no se puede deshacer. Las plazas se liberarán para otros viajeros.</p>
        <TextArea label="Motivo de la cancelación" error={errors.reason?.message} {...register('reason')} />
        {!!error && <Alert tone="error">{errorMessage(error)}</Alert>}
      </form>
    </Modal>
  );
}
