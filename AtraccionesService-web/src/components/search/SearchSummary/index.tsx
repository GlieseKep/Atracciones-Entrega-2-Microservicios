import { X } from 'lucide-react';
import { DURATION_OPTIONS, INCLUSION_OPTIONS, type CatalogFilters } from '@/features/attractions/filters';
import type { Category } from '@/types/attraction';
import { formatDate } from '@/utils/dates';
import { formatMoney } from '@/utils/formatters';

interface Props {
  filters: CatalogFilters;
  categories: Category[];
  onChange: (patch: Partial<CatalogFilters>) => void;
  onClear: () => void;
}

/** Chips con los filtros activos, removibles uno a uno. */
export function SearchSummary({ filters, categories, onChange, onClear }: Props) {
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.q) chips.push({ key: 'q', label: `“${filters.q}”`, remove: () => onChange({ q: '' }) });
  if (filters.city) chips.push({ key: 'city', label: filters.city, remove: () => onChange({ city: '' }) });
  if (filters.category) {
    const name = categories.find((c) => c.id === filters.category)?.nombre ?? 'Categoría';
    chips.push({ key: 'cat', label: name, remove: () => onChange({ category: '' }) });
  }
  if (filters.date) chips.push({ key: 'date', label: formatDate(filters.date), remove: () => onChange({ date: '' }) });
  if (filters.maxPrice) chips.push({ key: 'p', label: `Hasta ${formatMoney(filters.maxPrice)}`, remove: () => onChange({ maxPrice: null }) });
  if (filters.maxHours) {
    const label = DURATION_OPTIONS.find((o) => o.value === filters.maxHours)?.label ?? `Hasta ${filters.maxHours} h`;
    chips.push({ key: 'h', label, remove: () => onChange({ maxHours: null }) });
  }
  filters.includes.forEach((inc) =>
    chips.push({
      key: `i-${inc}`,
      label: INCLUSION_OPTIONS.find((o) => o.value === inc)?.label ?? inc,
      remove: () => onChange({ includes: filters.includes.filter((x) => x !== inc) }),
    }),
  );
  if (filters.language) chips.push({ key: 'l', label: `Guía en ${filters.language}`, remove: () => onChange({ language: '' }) });
  if (filters.freeCancellation) chips.push({ key: 'fc', label: 'Cancelación gratuita', remove: () => onChange({ freeCancellation: false }) });
  if (filters.accessible) chips.push({ key: 'acc', label: 'Silla de ruedas', remove: () => onChange({ accessible: false }) });

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
