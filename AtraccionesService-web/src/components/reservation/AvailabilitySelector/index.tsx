import { memo, useCallback, useEffect, useRef } from 'react';
import { Clock } from 'lucide-react';
import { ErrorState } from '@/components/common/Feedback';
import { isSoldOut, slotUnavailable } from '@/features/attractions/slots';
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
  /** Avisa cuando cambian los cupos en vivo del turno elegido, sin tocar el resto del formulario. */
  onSelectedSlotUpdate?: (slot: TimeSlot) => void;
}

/**
 * Turnos del día (`time_slots`) con stock en vivo: se consultan en segundo plano cada 3,5 s sin skeleton ni parpadeo
 * (solo se vuelve a pintar el turno cuyo cupo cambió). Deshabilita los agotados o con menos cupos que boletos; si el
 * turno elegido se agota, queda marcado como «Agotado» con un aviso.
 */
export function AvailabilitySelector({ attractionId, date, quantity, value, onChange, onSelectedSlotUpdate }: Props) {
  const availability = useAvailability(attractionId, date);
  const selectedSlot = availability.data?.time_slots.find((s) => s.slot_id === value);

  const onChangeRef = useRef(onChange);
  const onUpdateRef = useRef(onSelectedSlotUpdate);
  onChangeRef.current = onChange;
  onUpdateRef.current = onSelectedSlotUpdate;
  const select = useCallback((slot: TimeSlot) => onChangeRef.current(slot), []);

  // El diffing conserva el objeto del turno mientras no cambie: el aviso solo sale cuando cambian sus cupos.
  useEffect(() => {
    if (selectedSlot) onUpdateRef.current?.(selectedSlot);
  }, [selectedSlot]);

  if (!date) return <p className="text-sm text-ink-muted">Elige una fecha para ver los horarios.</p>;
  // Las consultas de fondo nunca pasan a `loading`: el skeleton solo sale en la carga inicial o al cambiar de fecha.
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
        {slots.map((slot) => (
          <SlotOption
            key={slot.slot_id}
            slot={slot}
            name={`slot-${attractionId}`}
            quantity={quantity}
            selected={value === slot.slot_id}
            onSelect={select}
          />
        ))}
      </div>
      {selectedSlot && slotUnavailable(selectedSlot, quantity) && (
        <p role="alert" className="mt-2 rounded-md bg-[#FEE2E2] px-3 py-2 text-sm font-semibold text-[#b91c1c]">
          {isSoldOut(selectedSlot)
            ? 'El horario elegido se agotó. Elige otro horario para continuar.'
            : 'El horario elegido ya no tiene cupos suficientes. Elige otro horario para continuar.'}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-muted">Hora de Ecuador continental.</p>
    </fieldset>
  );
}

interface SlotOptionProps {
  slot: TimeSlot;
  name: string;
  quantity: number;
  selected: boolean;
  onSelect: (slot: TimeSlot) => void;
}

/** Memoizado: un turno solo se vuelve a pintar si cambian sus cupos, su estado o la selección. */
const SlotOption = memo(function SlotOption({ slot, name, quantity, selected, onSelect }: SlotOptionProps) {
  const left = slot.available_slots;
  const soldOut = isSoldOut(slot);
  const insufficient = slotUnavailable(slot, quantity);
  const frame = selected
    ? insufficient
      ? 'border-[#b91c1c] bg-[#FEE2E2] ring-1 ring-[#b91c1c]'
      : 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
    : insufficient
      ? 'cursor-not-allowed border-line opacity-50'
      : 'border-line hover:border-ink';

  return (
    <label className={`flex cursor-pointer flex-col rounded-md border px-3 py-2.5 transition ${frame}`}>
      <input
        type="radio"
        name={name}
        value={slot.slot_id}
        checked={selected}
        disabled={insufficient}
        onChange={() => onSelect(slot)}
        className="sr-only"
      />
      <span className="flex items-center gap-1.5 font-bold">
        <Clock size={15} aria-hidden="true" /> {slot.time}
      </span>
      <span
        className={`text-xs transition-colors duration-300 ${
          soldOut && selected ? 'font-semibold text-[#b91c1c]' : slot.status === 'ULTIMOS_CUPOS' ? 'font-semibold text-danger' : 'text-ink-muted'
        }`}
      >
        {soldOut
          ? 'Agotado'
          : left < quantity
            ? `Solo ${left} ${left === 1 ? 'cupo' : 'cupos'}`
            : slot.status === 'ULTIMOS_CUPOS'
              ? `¡Quedan ${left}!`
              : `${left} cupos`}
      </span>
    </label>
  );
});
