import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Check, ChevronDown, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { AvailabilityCalendar } from '@/components/reservation/AvailabilityCalendar';
import { AvailabilitySelector } from '@/components/reservation/AvailabilitySelector';
import { QuantityStepper } from '@/components/reservation/QuantityStepper';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
import type { Attraction } from '@/types/attraction';
import { formatDate } from '@/utils/dates';
import { formatMoney, formatPrice } from '@/utils/formatters';
import { paths } from '@/utils/routes';

/**
 * Caja de reserva fija a la derecha del detalle (patrón Viator): precio "desde", fecha, viajeros,
 * "Comprobar disponibilidad" y, tras elegir horario, "Reservar ahora" o "Comprar y pagar".
 */
export function BookingCard({ attraction }: { attraction: Attraction }) {
  const [date, setDate] = useState('');
  const [quantity, setQuantity] = useState(2);
  const [time, setTime] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const { isAuthenticated } = useAuth();
  const requestLogin = useUiStore((s) => s.requestLogin);
  const navigate = useNavigate();

  const query = new URLSearchParams({ fecha: date, hora: time, cantidad: String(quantity) });
  const go = (to: string) =>
    isAuthenticated ? navigate(to) : requestLogin(to, 'Inicia sesión para reservar esta experiencia con disponibilidad garantizada.');

  return (
    <div className="card-surface p-5 shadow-card">
      <p className="text-sm text-ink-soft">Desde</p>
      <p className="text-3xl font-extrabold">
        {formatPrice(attraction.price)} <span className="text-base font-normal text-ink-soft">por persona</span>
      </p>
      {attraction.freeCancellation && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-success">
          <Check size={16} aria-hidden="true" /> Cancelación gratuita
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
                  setTime('');
                  setCalendarOpen(false);
                }}
              />
            </div>
          )}
        </div>
        <div className="rounded-full border border-line px-4 py-2">
          <QuantityStepper value={quantity} onChange={setQuantity} label="Viajeros" />
        </div>
      </div>

      {!checked ? (
        <Button className="mt-5" size="lg" fullWidth disabled={!date} onClick={() => setChecked(true)}>
          Comprobar disponibilidad
        </Button>
      ) : (
        <div className="fade-in mt-5">
          <p className="mb-2 font-bold">Elige un horario</p>
          <AvailabilitySelector attractionId={attraction.id} date={date} quantity={quantity} value={time} onChange={setTime} />
          {time && (
            <div className="mt-4 rounded-md bg-surface p-3 text-sm">
              <div className="flex justify-between">
                <span>
                  {quantity} × {formatPrice(attraction.price)}
                </span>
                <span className="font-bold">{formatMoney(attraction.price.total * quantity, attraction.price.currency)}</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">Importe estimado; el servidor confirma el precio final.</p>
            </div>
          )}
          <div className="mt-4 grid gap-2">
            <Button size="lg" fullWidth disabled={!time} onClick={() => go(paths.purchase(attraction.id, query))}>
              Comprar y pagar ahora
            </Button>
            <Button variant="secondary" size="lg" fullWidth disabled={!time} onClick={() => go(paths.reserve(attraction.id, query))}>
              Reservar ahora, pagar después
            </Button>
          </div>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs text-ink-soft">
        <ShieldCheck size={16} className="shrink-0 text-success" aria-hidden="true" />
        Disponibilidad verificada en tiempo real y pago 100 % simulado y seguro.
      </p>
    </div>
  );
}
