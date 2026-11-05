import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Ticket } from 'lucide-react';
import { getOrder } from '@/api/orders';
import { ButtonLink } from '@/components/common/Button';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { Select } from '@/components/common/Select';
import { Pagination } from '@/components/search/SearchResults';
import { useAsync } from '@/hooks/useAsync';
import { useMyReservations } from '@/hooks/useReservations';
import type { Reservation, ReservationStatus } from '@/types/booking';
import { formatDate } from '@/utils/dates';
import { describeTickets, formatMoney, lineAttractionName } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { ReservationStatusBadge } from '../StatusBadge';

const PAGE = 10;

/** Reservas del usuario (`bookingListReservations`): Booking las busca a partir de sus órdenes. */
export function ReservationHistory() {
  const [status, setStatus] = useState<ReservationStatus | ''>('');
  const [page, setPage] = useState(1);
  const reservations = useMyReservations({ estado: status || undefined, page, limit: PAGE });
  const totalPages = Math.max(1, Math.ceil((reservations.data?.total_results ?? 0) / PAGE));

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-3">
        <Select
          label="Estado"
          className="w-56"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ReservationStatus | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'Todas' },
            { value: 'CONFIRMED', label: 'Confirmadas' },
            { value: 'PENDING', label: 'Pendientes de pago' },
            { value: 'CHECKED_IN', label: 'Con check-in' },
            { value: 'COMPLETED', label: 'Completadas' },
            { value: 'CANCELLED', label: 'Canceladas' },
            { value: 'EXPIRED', label: 'Vencidas' },
          ]}
        />
      </div>

      {reservations.status === 'loading' && !reservations.data && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      )}
      {reservations.status === 'error' && <ErrorState error={reservations.error} onRetry={reservations.retry} />}
      {reservations.data && reservations.data.items.length === 0 && (
        <EmptyState title="No hay reservas" action={<ButtonLink to={paths.attractions()}>Explorar experiencias</ButtonLink>}>
          Cuando compres una experiencia aparecerá aquí con su estado y su voucher.
        </EmptyState>
      )}
      {reservations.data && reservations.data.items.length > 0 && (
        <>
          <ul className="space-y-3">
            {reservations.data.items.map((r) => (
              <ReservationRow key={r.reservation_id} reservation={r} />
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** Booking trae el nombre de la atracción; si falta (reservas anteriores), se toma de la orden. */
function ReservationRow({ reservation: r }: { reservation: Reservation }) {
  const order = useAsync((signal) => getOrder(r.external_order_id, signal), [r.external_order_id], !r.attraction_name);
  const line = order.data?.lineas[0];
  const name = r.attraction_name || (line ? lineAttractionName(line.descripcion) : 'Experiencia');
  return (
    <li>
      <Link to={paths.reservation(r.reservation_id)} className="card-surface flex items-center gap-4 p-4 transition hover:shadow-card">
        <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 sm:flex" aria-hidden="true">
          <Ticket size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14} aria-hidden="true" /> {formatDate(r.date)} · {r.time}
            </span>
            <span>{describeTickets({ adult: r.adult_count, child: r.child_count, senior: r.senior_count, infant: r.infant_count })}</span>
            <span className="font-mono text-xs">{r.reservation_code}</span>
          </p>
        </div>
        <div className="text-right">
          <ReservationStatusBadge status={r.status} />
          <p className="mt-1 font-bold">{formatMoney(r.total_price, r.currency)}</p>
        </div>
        <ChevronRight size={18} className="text-ink-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}
