import { Clock } from 'lucide-react';
import { ErrorState } from '@/components/common/Feedback';
import { useAvailability } from '@/hooks/useAttractions';
import type { IsoDate } from '@/types/api';
import type { AvailabilitySlot } from '@/types/attraction';

interface Props {
  attractionId: string;
  date: IsoDate | '';
  quantity: number;
  value: string;
  onChange: (time: string, slot: AvailabilitySlot) => void;
  onLogin?: () => void;
}

/** Franjas horarias del día con cupos restantes. Deshabilita las agotadas o con menos plazas que la cantidad pedida. */
export function AvailabilitySelector({ attractionId, date, quantity, value, onChange, onLogin }: Props) {
  const availability = useAvailability(attractionId, date);

  if (!date) return <p className="text-sm text-ink-muted">Elige una fecha para ver los horarios.</p>;
  if (availability.status === 'loading') {
    return (
      <div className="grid grid-cols-2 gap-2" aria-busy="true">
        <div className="skeleton h-14" />
        <div className="skeleton h-14" />
        <span className="sr-only" role="status">
          Consultando disponibilidad…
        </span>
      </div>
    );
  }
  if (availability.status === 'error') {
    return <ErrorState error={availability.error} onRetry={availability.retry} onLogin={onLogin} className="py-6" />;
  }

  const slots = availability.data.times;
  if (!slots.length) {
    return (
      <p role="status" className="rounded-md bg-surface px-4 py-3 text-sm">
        No hay horarios disponibles para esta fecha. Prueba con otro día.
      </p>
    );
  }

  return (
    <fieldset>
      <legend className="sr-only">Horario</legend>
      <div className="grid grid-cols-2 gap-2">
        {slots.map((slot) => {
          const insufficient = slot.status === 'SOLD_OUT' || slot.availableSpots < quantity;
          const selected = value === slot.time;
          return (
            <label
              key={slot.time}
              className={`flex cursor-pointer flex-col rounded-md border px-3 py-2.5 transition ${
                selected ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-line hover:border-ink'
              } ${insufficient ? 'cursor-not-allowed opacity-50 hover:border-line' : ''}`}
            >
              <input
                type="radio"
                name={`slot-${attractionId}`}
                value={slot.time}
                checked={selected}
                disabled={insufficient}
                onChange={() => onChange(slot.time, slot)}
                className="sr-only"
              />
              <span className="flex items-center gap-1.5 font-bold">
                <Clock size={15} aria-hidden="true" /> {slot.time}
              </span>
              <span className={`text-xs ${slot.availableSpots <= 5 && slot.availableSpots > 0 ? 'font-semibold text-danger' : 'text-ink-muted'}`}>
                {slot.status === 'SOLD_OUT' || slot.availableSpots === 0
                  ? 'Agotado'
                  : slot.availableSpots < quantity
                    ? `Solo ${slot.availableSpots} plazas`
                    : slot.availableSpots <= 5
                      ? `¡Quedan ${slot.availableSpots}!`
                      : `${slot.availableSpots} plazas`}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-muted">Hora local ({availability.data.timeZone}).</p>
    </fieldset>
  );
}
