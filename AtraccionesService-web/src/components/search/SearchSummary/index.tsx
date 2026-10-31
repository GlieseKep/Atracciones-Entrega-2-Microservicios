import { X } from 'lucide-react';
import { DURATION_OPTIONS, type CatalogFilters } from '@/features/attractions/filters';
import { formatDate } from '@/utils/dates';
import { formatLanguage, formatMoney } from '@/utils/formatters';

interface Props {
  filters: CatalogFilters;
  onChange: (patch: Partial<CatalogFilters>) => void;
  onClear: () => void;
}

/** Chips con los filtros activos, removibles uno a uno. */
export function SearchSummary({ filters, onChange, onClear }: Props) {
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.q) chips.push({ key: 'q', label: `“${filters.q}”`, remove: () => onChange({ q: '' }) });
  if (filters.city) chips.push({ key: 'city', label: filters.city, remove: () => onChange({ city: '' }) });
  if (filters.date) chips.push({ key: 'date', label: formatDate(filters.date), remove: () => onChange({ date: '' }) });
  filters.categories.forEach((c) =>
    chips.push({ key: `c-${c}`, label: c, remove: () => onChange({ categories: filters.categories.filter((x) => x !== c) }) }),
  );
  filters.durations.forEach((d) =>
    chips.push({
      key: `d-${d}`,
      label: DURATION_OPTIONS.find((o) => o.value === d)?.label ?? d,
      remove: () => onChange({ durations: filters.durations.filter((x) => x !== d) }),
    }),
  );
  if (filters.maxPrice) chips.push({ key: 'p', label: `Hasta ${formatMoney(filters.maxPrice)}`, remove: () => onChange({ maxPrice: null }) });
  if (filters.minRating) chips.push({ key: 'r', label: `${filters.minRating}+ estrellas`, remove: () => onChange({ minRating: null }) });
  if (filters.language) chips.push({ key: 'l', label: formatLanguage(filters.language), remove: () => onChange({ language: '' }) });
  if (filters.freeCancellation) chips.push({ key: 'fc', label: 'Cancelación gratuita', remove: () => onChange({ freeCancellation: false }) });

  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Filtros aplicados">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.remove}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-white px-3 py-1 text-sm font-semibold hover:bg-surface"
          aria-label={`Quitar filtro ${chip.label}`}
        >
          {chip.label} <X size={14} aria-hidden="true" />
        </button>
      ))}
      <button type="button" onClick={onClear} className="link text-sm">
        Borrar todo
      </button>
    </div>
  );
}
