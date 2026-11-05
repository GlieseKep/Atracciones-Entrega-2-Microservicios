import { useId, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: ReactNode;
}

/** Selector − n + */
export function QuantityStepper({ value, onChange, min = 1, max = 20, label = 'Boletos' }: Props) {
  const labelId = useId();
  const btn = 'flex h-9 w-9 items-center justify-center rounded-full border border-line hover:border-ink disabled:opacity-30 disabled:hover:border-line';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-semibold" id={labelId}>
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-3" role="group" aria-labelledby={labelId}>
        <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Quitar uno">
          <Minus size={16} aria-hidden="true" />
        </button>
        <output className="w-6 text-center font-bold" aria-live="polite">
          {value}
        </output>
        <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Añadir uno">
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
