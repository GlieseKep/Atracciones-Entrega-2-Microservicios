import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Ticket } from 'lucide-react';
import { Select } from '@/components/common/Select';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { ButtonLink } from '@/components/common/Button';
import { Pagination } from '@/components/search/SearchResults';
import { useMyReservations } from '@/hooks/useReservations';
import { useAllAttractions } from '@/hooks/useAttractions';
import type { ReservationStatus } from '@/types/reservation';
import { formatDate } from '@/utils/dates';
import { formatPrice, shortCode } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { ReservationStatusBadge } from '../StatusBadge';

const PAGE = 10;

/** Historial de reservas del usuario autenticado (GET /customers/me/reservations). */
export function ReservationHistory() {
  const [status, setStatus] = useState<ReservationStatus | ''>('');
  const [sort, setSort] = useState<'-date' | 'date'>('-date');
  const [page, setPage] = useState(1);
  const reservations = useMyReservations({ limit: PAGE, offset: (page - 1) * PAGE, status: status || undefined, sort });
  const catalog = useAllAttractions();
  const nameOf = (id: string) => catalog.data?.find((a) => a.id === id)?.name ?? 'Atracción';

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-3">
        <Select
          label="Estado"
          className="w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ReservationStatus | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'Todas' },
            { value: 'CONFIRMED', label: 'Confirmadas' },
            { value: 'PENDING', label: 'Pendientes' },
            { value: 'CANCELLED', label: 'Canceladas' },
          ]}
        />
        <Select
          label="Orden"
          className="w-48"
          value={sort}
          onChange={(e) => setSort(e.target.value as '-date' | 'date')}
          options={[
            { value: '-date', label: 'Más recientes' },
            { value: 'date', label: 'Más antiguas' },
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
      {reservations.data && reservations.data.data.length === 0 && (
        <EmptyState title="Todavía no tienes reservas" action={<ButtonLink to={paths.attractions()}>Explorar experiencias</ButtonLink>}>
          Cuando reserves una experiencia aparecerá aquí con su estado.
        </EmptyState>
      )}
      {reservations.data && reservations.data.data.length > 0 && (
        <>
          <ul className="space-y-3">
            {reservations.data.data.map((r) => (
              <li key={r.reservationId}>
                <Link
                  to={paths.reservation(r.reservationId)}
                  className="card-surface flex items-center gap-4 p-4 transition hover:shadow-card"
                >
                  <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 sm:flex" aria-hidden="true">
                    <Ticket size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{nameOf(r.attractionId)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays size={14} aria-hidden="true" /> {formatDate(r.date)} · {r.time}
                      </span>
                      <span>{r.ticketCount} entradas</span>
                      <span className="font-mono text-xs">#{shortCode(r.reservationId)}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <ReservationStatusBadge status={r.status} />
                    <p className="mt-1 font-bold">{formatPrice(r.totalPrice)}</p>
                  </div>
                  <ChevronRight size={18} className="text-ink-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={reservations.data.totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
