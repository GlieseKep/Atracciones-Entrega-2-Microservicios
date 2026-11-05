import { Clock } from 'lucide-react';
import { ErrorState } from '@/components/common/Feedback';
import { useAvailability } from '@/hooks/useAttractions';
import type { IsoDate } from '@/types/api';
import type { TimeSlot } from '@/types/attraction';

interface Props {
  attractionId: string;
  date: IsoDate | '';
  /** Boletos que ocupan cupo (los infantes también cuentan). */
  quantity: number;
  /** `slot_id` elegido. */
  value: string;
  onChange: (slot: TimeSlot) => void;
}

/** Turnos del día (`time_slots`) con cupos en tiempo real. Deshabilita los agotados o con menos cupos que boletos. */
export function AvailabilitySelector({ attractionId, date, quantity, value, onChange }: Props) {
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
    return <ErrorState error={availability.error} onRetry={availability.retry} className="py-6" />;
  }

  const slots = availability.data.time_slots;
  if (!slots.length) {
    return (
      <p role="status" className="rounded-md bg-surface px-4 py-3 text-sm">
        No hay horarios para esta fecha. Prueba con otro día.
      </p>
    );
  }

  return (
    <fieldset>
      <legend className="sr-only">Horario</legend>
      <div className="grid grid-cols-2 gap-2">
        {slots.map((slot) => {
          const left = slot.available_slots;
          const insufficient = slot.status === 'AGOTADO' || left < quantity;
          const selected = value === slot.slot_id;
          return (
            <label
              key={slot.slot_id}
              className={`flex cursor-pointer flex-col rounded-md border px-3 py-2.5 transition ${
                selected ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-line hover:border-ink'
              } ${insufficient ? 'cursor-not-allowed opacity-50 hover:border-line' : ''}`}
            >
              <input
                type="radio"
                name={`slot-${attractionId}`}
                value={slot.slot_id}
                checked={selected}
                disabled={insufficient}
                onChange={() => onChange(slot)}
                className="sr-only"
              />
              <span className="flex items-center gap-1.5 font-bold">
                <Clock size={15} aria-hidden="true" /> {slot.time}
              </span>
              <span className={`text-xs ${slot.status === 'ULTIMOS_CUPOS' ? 'font-semibold text-danger' : 'text-ink-muted'}`}>
                {slot.status === 'AGOTADO' || left === 0
                  ? 'Agotado'
                  : left < quantity
                    ? `Solo ${left} ${left === 1 ? 'cupo' : 'cupos'}`
                    : slot.status === 'ULTIMOS_CUPOS'
                      ? `¡Quedan ${left}!`
                      : `${left} cupos`}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-muted">Hora de Ecuador continental.</p>
    </fieldset>
  );
}
