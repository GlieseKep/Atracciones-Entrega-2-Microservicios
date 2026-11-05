import { CalendarDays, Check, Clock, Info } from 'lucide-react';
import { photoAt } from '@/features/content/photos';
import type { AttractionDetail } from '@/types/attraction';
import type { TicketCounts } from '@/types/booking';
import { formatDate } from '@/utils/dates';
import { estimateTotal, formatMoney, TICKET_TYPES } from '@/utils/formatters';

interface Props {
  attraction: AttractionDetail;
  date: string;
  time: string;
  tickets: TicketCounts;
  /** Descuento estimado del cupón validado. */
  discount?: number;
}

/** Resumen lateral de la compra con el importe estimado según la tarifa del catálogo. */
export function CheckoutSummary({ attraction: a, date, time, tickets, discount = 0 }: Props) {
  const subtotal = estimateTotal(a.price, tickets);
  const photo = a.photos?.[0];
  return (
    <aside className="card-surface overflow-hidden" aria-label="Resumen de la compra">
      <div className="flex gap-3 border-b border-line p-4">
        {photo && <img src={photoAt(photo, 330)} alt="" className="h-20 w-20 shrink-0 rounded-sm object-cover" />}
        <div>
          <p className="font-bold leading-snug">{a.name}</p>
          <p className="mt-1 text-sm text-ink-muted">{a.city}</p>
        </div>
      </div>
      <ul className="space-y-2.5 p-4 text-sm">
        <li className="flex items-center gap-2">
          <CalendarDays size={16} aria-hidden="true" /> {date ? formatDate(date, { weekday: 'long', month: 'long' }) : 'Fecha por elegir'}
        </li>
        <li className="flex items-center gap-2">
          <Clock size={16} aria-hidden="true" /> {time ? `${time}${a.duration ? ` · ${a.duration}` : ''}` : 'Horario por elegir'}
        </li>
        {a.cancellation_policy?.free_cancellation && (
          <li className="flex items-center gap-2 font-semibold text-success">
            <Check size={16} aria-hidden="true" /> Cancelación gratuita hasta {a.cancellation_policy.deadline_hours} h antes
          </li>
        )}
      </ul>
      <div className="border-t border-line p-4">
        <ul className="space-y-1 text-sm text-ink-soft">
          {TICKET_TYPES.filter(({ type }) => tickets[type] > 0).map(({ type, label }) => (
            <li key={type} className="flex justify-between">
              <span>
                {label} × {tickets[type]}
              </span>
              <span>{formatMoney(a.price[type] * tickets[type], a.price.currency)}</span>
            </li>
          ))}
          {discount > 0 && (
            <li className="flex justify-between text-success">
              <span>Cupón</span>
              <span>−{formatMoney(discount, a.price.currency)}</span>
            </li>
          )}
        </ul>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-bold">Total estimado</span>
          <span className="text-xl font-extrabold">{formatMoney(Math.max(0, subtotal - discount), a.price.currency)}</span>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Precio según la tarifa publicada. El total final (con impuestos y descuentos) lo calcula el servidor al pagar.
        </p>
      </div>
    </aside>
  );
}
