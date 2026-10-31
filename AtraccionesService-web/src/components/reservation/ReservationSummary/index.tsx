import type { ReactNode } from 'react';
import { CalendarDays, Check, Clock, Info, Users } from 'lucide-react';
import { photoAt } from '@/components/attractions/AttractionCard';
import type { Attraction } from '@/types/attraction';
import { formatDate } from '@/utils/dates';
import { formatDuration, formatMoney } from '@/utils/formatters';

interface Props {
  attraction: Attraction;
  date?: string;
  time?: string;
  quantity: number;
  /** Total confirmado por el servidor; si falta se muestra un estimado con el precio del catálogo. */
  confirmedTotal?: { amount: number; currency: string };
  children?: ReactNode;
}

/** Resumen lateral del pedido (columna derecha del checkout de Viator). */
export function ReservationSummary({ attraction, date, time, quantity, confirmedTotal, children }: Props) {
  const estimated = attraction.price.total * quantity;
  const photo = attraction.photos[0]?.url;
  return (
    <aside className="card-surface overflow-hidden" aria-label="Resumen del pedido">
      <div className="flex gap-3 border-b border-line p-4">
        {photo && <img src={photoAt(photo, 330)} alt="" className="h-20 w-20 shrink-0 rounded-sm object-cover" />}
        <div>
          <p className="font-bold leading-snug">{attraction.name}</p>
          <p className="mt-1 text-sm text-ink-muted">{attraction.locations[0]?.city}</p>
        </div>
      </div>
      <ul className="space-y-2.5 p-4 text-sm">
        <li className="flex items-center gap-2">
          <CalendarDays size={16} aria-hidden="true" /> {date ? formatDate(date, { weekday: 'long', month: 'long' }) : 'Fecha por elegir'}
        </li>
        <li className="flex items-center gap-2">
          <Clock size={16} aria-hidden="true" /> {time ? `${time} · ${formatDuration(attraction.duration)}` : 'Horario por elegir'}
        </li>
        <li className="flex items-center gap-2">
          <Users size={16} aria-hidden="true" /> {quantity} {quantity === 1 ? 'entrada' : 'entradas'}
        </li>
        {attraction.freeCancellation && (
          <li className="flex items-center gap-2 font-semibold text-success">
            <Check size={16} aria-hidden="true" /> Cancelación gratuita
          </li>
        )}
      </ul>
      <div className="border-t border-line p-4">
        <div className="flex justify-between text-sm text-ink-soft">
          <span>
            {formatMoney(attraction.price.total, attraction.price.currency)} × {quantity}
          </span>
          <span>{formatMoney(estimated, attraction.price.currency)}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-bold">Total</span>
          <span className="text-xl font-extrabold">
            {formatMoney(confirmedTotal?.amount ?? estimated, confirmedTotal?.currency ?? attraction.price.currency)}
          </span>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {confirmedTotal
            ? 'Precio calculado y confirmado por el servidor.'
            : 'Precio estimado. El servidor calcula el importe final al confirmar.'}
        </p>
        {children}
      </div>
    </aside>
  );
}
