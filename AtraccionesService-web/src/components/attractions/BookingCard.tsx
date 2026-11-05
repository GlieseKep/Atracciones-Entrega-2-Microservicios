import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Check, ChevronDown, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { AvailabilityCalendar } from '@/components/reservation/AvailabilityCalendar';
import { AvailabilitySelector } from '@/components/reservation/AvailabilitySelector';
import { DEFAULT_TICKETS, TicketSelector } from '@/components/reservation/TicketSelector';
import { slotTime, toCheckoutQuery } from '@/features/attractions/checkoutQuery';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
import type { AttractionDetail, TimeSlot } from '@/types/attraction';
import type { TicketCounts } from '@/types/booking';
import { formatDate } from '@/utils/dates';
import { describeTickets, estimateTotal, formatFromPrice, formatMoney, ticketTotal } from '@/utils/formatters';
import { paths } from '@/utils/routes';

/**
 * Caja de compra del detalle: fecha, boletos por tipo y turno con cupos en tiempo real. La compra se completa en
 * `/atracciones/:id/comprar`, donde Booking crea la orden, reserva los cupos y cobra en un solo paso.
 */
export function BookingCard({ attraction }: { attraction: AttractionDetail }) {
  const [date, setDate] = useState('');
  const [tickets, setTickets] = useState<TicketCounts>(DEFAULT_TICKETS);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const requestLogin = useUiStore((s) => s.requestLogin);
  const navigate = useNavigate();
  const quantity = ticketTotal(tickets);
  const free = attraction.cancellation_policy?.free_cancellation;

  const proceed = () => {
    if (!slot) return;
    const to = paths.checkout(attraction.id, toCheckoutQuery({ date, slotId: slot.slot_id, time: slotTime(slot), tickets }));
    if (isAuthenticated) navigate(to);
    else requestLogin(to, 'Inicia sesión para comprar esta experiencia con cupos garantizados.');
  };

  return (
    <div className="card-surface p-5 shadow-card">
      <p className="text-sm text-ink-soft">Desde</p>
      <p className="text-3xl font-extrabold">
        {formatFromPrice(attraction.price)} <span className="text-base font-normal text-ink-soft">por adulto</span>
      </p>
      {free && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-success">
          <Check size={16} aria-hidden="true" /> Cancelación gratuita hasta {attraction.cancellation_policy?.deadline_hours} h antes
        </p>
      )}

      <div className="mt-5 space-y-3">
        <div>
          <button
            type="button"
            onClick={() => setCalendarOpen((v) => !v)}
            aria-expanded={calendarOpen}
            className="flex w-full items-center justify-between rounded-full border border-line px-4 py-3 text-left hover:border-ink"
          >
            <span className="flex items-center gap-2">
              <CalendarDays size={18} aria-hidden="true" />
              <span className={date ? 'font-semibold' : 'text-ink-muted'}>{date ? formatDate(date) : 'Seleccionar fecha'}</span>
            </span>
            <ChevronDown size={18} aria-hidden="true" className={calendarOpen ? 'rotate-180' : ''} />
          </button>
          {calendarOpen && (
            <div className="fade-in mt-2 rounded-md border border-line p-3">
              <AvailabilityCalendar
                value={date}
                onChange={(d) => {
                  setDate(d);
                  setSlot(null);
                  setCalendarOpen(false);
                }}
              />
            </div>
          )}
        </div>
        <div className="rounded-md border border-line px-4 py-3">
          <TicketSelector value={tickets} onChange={setTickets} price={attraction.price} />
        </div>
      </div>

      {date && (
        <div className="fade-in mt-5">
          <p className="mb-2 font-bold">Elige un horario</p>
          <AvailabilitySelector attractionId={attraction.id} date={date} quantity={quantity} value={slot?.slot_id ?? ''} onChange={setSlot} />
        </div>
      )}

      {slot && (
        <div className="mt-4 rounded-md bg-surface p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span>{describeTickets(tickets)}</span>
            <span className="font-bold">{formatMoney(estimateTotal(attraction.price, tickets), attraction.price.currency)}</span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Importe estimado; el total final se confirma al pagar.</p>
        </div>
      )}

      <Button className="mt-5" size="lg" fullWidth disabled={!slot || slot.available_slots < quantity} onClick={proceed}>
        Continuar con la compra
      </Button>

      <p className="mt-4 flex items-start gap-2 text-xs text-ink-soft">
        <ShieldCheck size={16} className="shrink-0 text-success" aria-hidden="true" />
        Cupos verificados en tiempo real. Si el horario se agota al pagar, no se cobra nada.
      </p>
    </div>
  );
}
