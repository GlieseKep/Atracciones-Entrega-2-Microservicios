import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { IsoDate } from '@/types/api';
import { parseIsoDate, toIsoDate, today } from '@/utils/dates';

interface Props {
  value: IsoDate | '';
  onChange: (date: IsoDate) => void;
  /** Días hacia adelante que se pueden reservar. */
  maxDaysAhead?: number;
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Calendario mensual compacto. Las fechas pasadas o fuera de rango quedan deshabilitadas. */
export function AvailabilityCalendar({ value, onChange, maxDaysAhead = 180 }: Props) {
  const min = today();
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + maxDaysAhead);
  const max = toIsoDate(maxDate);

  const initial = value ? parseIsoDate(value) : new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));

  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // semana empieza en lunes
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: count }, (_, i) => toIsoDate(new Date(month.getFullYear(), month.getMonth(), i + 1))),
    ];
  }, [month]);

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const canPrev = toIsoDate(new Date(month.getFullYear(), month.getMonth(), 0)) >= min;
  const canNext = toIsoDate(new Date(month.getFullYear(), month.getMonth() + 1, 1)) <= max;
  const title = month.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Mes anterior" className="rounded-full p-1.5 hover:bg-surface disabled:opacity-30">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <p className="font-bold capitalize" aria-live="polite">
          {title}
        </p>
        <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Mes siguiente" className="rounded-full p-1.5 hover:bg-surface disabled:opacity-30">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-ink-muted" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label={`Días de ${title}`}>
        {days.map((day, i) =>
          day === null ? (
            <span key={`pad-${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              disabled={day < min || day > max}
              onClick={() => onChange(day)}
              aria-pressed={day === value}
              aria-label={parseIsoDate(day).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' })}
              className={`aspect-square rounded-full text-sm transition ${
                day === value
                  ? 'bg-brand-500 font-bold text-white'
                  : 'hover:bg-brand-100 disabled:cursor-not-allowed disabled:text-[#C9C2C3] disabled:hover:bg-transparent'
              } ${day === min && day !== value ? 'font-bold underline' : ''}`}
            >
              {Number(day.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
