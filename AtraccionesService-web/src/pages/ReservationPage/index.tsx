import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { ErrorState } from '@/components/common/Feedback';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { ReservationForm } from '@/components/reservation/ReservationForm';
import { ReservationSummary } from '@/components/reservation/ReservationSummary';
import { useAttraction } from '@/hooks/useAttractions';
import { useAuth } from '@/hooks/useAuth';
import { useCreateReservation } from '@/hooks/useReservations';
import { useUiStore } from '@/stores/uiStore';
import { isNotPast, isValidLocalTime } from '@/utils/dates';
import { paths } from '@/utils/routes';
import type { ReservationFormValues } from '@/utils/validation';

/** Checkout de reserva: formulario a la izquierda, resumen fijo a la derecha. */
export default function ReservationPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const attraction = useAttraction(id);
  const { claims, user, signIn } = useAuth();
  const navigate = useNavigate();
  const notify = useUiStore((s) => s.notify);
  const { run, pending, error } = useCreateReservation(id);

  const qDate = params.get('fecha') ?? '';
  const qTime = params.get('hora') ?? '';
  const qty = Math.min(100, Math.max(1, Number(params.get('cantidad')) || 1));
  const [selection, setSelection] = useState({
    date: isNotPast(qDate) ? qDate : '',
    time: isValidLocalTime(qTime) ? qTime : '',
    ticketCount: qty,
  });

  if (attraction.status === 'error') {
    return (
      <div className="page-container pt-10">
        <ErrorState error={attraction.error} onRetry={attraction.retry} onLogin={() => signIn()} />
      </div>
    );
  }
  if (!attraction.data) return <div className="page-container skeleton mt-10 h-96" aria-busy="true" />;
  const a = attraction.data;

  const submit = async (values: ReservationFormValues) => {
    try {
      const reservation = await run({
        date: values.date,
        time: values.time,
        ticketCount: Number(values.ticketCount),
        customerName: values.customerName.trim(),
        customerEmail: values.customerEmail.trim(),
      });
      notify('¡Reserva confirmada! Te enviamos los detalles por correo.', 'success');
      navigate(paths.reservation(reservation.reservationId), { replace: true });
    } catch {
      /* el error se muestra en el formulario */
    }
  };

  return (
    <div className="page-container pt-4">
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: a.name, to: paths.attraction(a.id) }, { label: 'Reservar' }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">Completa tu reserva</h1>
        <p className="flex items-center gap-1.5 text-sm text-ink-soft">
          <Lock size={14} aria-hidden="true" /> Proceso seguro
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <ReservationForm
          attraction={a}
          defaults={{
            ...selection,
            customerName: claims?.name ?? '',
            customerEmail: user?.email ?? claims?.email ?? '',
          }}
          submitting={pending}
          error={error}
          onSubmit={submit}
          onChangeSelection={(v) => setSelection((s) => ({ ...s, ...v, ticketCount: Number(v.ticketCount ?? s.ticketCount) }))}
        />
        <div className="lg:sticky lg:top-36 lg:self-start">
          <ReservationSummary attraction={a} date={selection.date} time={selection.time} quantity={selection.ticketCount} />
        </div>
      </div>
    </div>
  );
}
