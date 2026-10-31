import { useId, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import { DURATION_OPTIONS, type CatalogFilters } from '@/features/attractions/filters';
import { today } from '@/utils/dates';
import { formatLanguage, formatMoney } from '@/utils/formatters';

export interface FilterFacets {
  categories: [string, number][];
  cities: [string, number][];
  languages: [string, number][];
  maxPrice: number;
}

interface Props {
  filters: CatalogFilters;
  facets: FilterFacets;
  onChange: (patch: Partial<CatalogFilters>) => void;
}

/** Panel lateral de filtros con las mismas secciones que Viator: fecha, categorías, precio, duración, valoración, especiales. */
export function AttractionFilters({ filters, facets, onChange }: Props) {
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const priceCeiling = Math.max(10, Math.ceil(facets.maxPrice / 10) * 10);
  const dateId = useId();
  const priceId = useId();

  return (
    <div className="divide-y divide-line">
      <FilterGroup title="¿Cuándo viajas?">
        <label htmlFor={dateId} className="sr-only">
          Fecha de la actividad
        </label>
        <input
          id={dateId}
          type="date"
          min={today()}
          value={filters.date}
          onChange={(e) => onChange({ date: e.target.value })}
          className="field-input"
        />
      </FilterGroup>

      {facets.cities.length > 1 && (
        <FilterGroup title="Destino">
          {facets.cities.map(([city, count]) => (
            <Check
              key={city}
              type="radio"
              name="city"
              label={city}
              count={count}
              checked={filters.city === city}
              onChange={() => onChange({ city: filters.city === city ? '' : city })}
            />
          ))}
          {filters.city && (
            <button type="button" className="link mt-1 text-sm" onClick={() => onChange({ city: '' })}>
              Todos los destinos
            </button>
          )}
        </FilterGroup>
      )}

      <FilterGroup title="Categorías">
        {facets.categories.map(([cat, count]) => (
          <Check
            key={cat}
            label={cat}
            count={count}
            checked={filters.categories.includes(cat)}
            onChange={() => onChange({ categories: toggle(filters.categories, cat) })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Precio">
        <label htmlFor={priceId} className="flex justify-between text-sm">
          <span>Precio máximo</span>
          <span className="font-semibold">{filters.maxPrice ? formatMoney(filters.maxPrice) : 'Cualquiera'}</span>
        </label>
        <input
          id={priceId}
          type="range"
          min={10}
          max={priceCeiling}
          step={5}
          value={filters.maxPrice ?? priceCeiling}
          onChange={(e) => {
            const value = Number(e.target.value);
            onChange({ maxPrice: value >= priceCeiling ? null : value });
          }}
          className="mt-3 w-full accent-[#C94D6B]"
        />
        <div className="flex justify-between text-xs text-ink-muted">
          <span>{formatMoney(10)}</span>
          <span>{formatMoney(priceCeiling)}+</span>
        </div>
      </FilterGroup>

      <FilterGroup title="Duración">
        {DURATION_OPTIONS.map((o) => (
          <Check
            key={o.value}
            label={o.label}
            checked={filters.durations.includes(o.value)}
            onChange={() => onChange({ durations: toggle(filters.durations, o.value) })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Valoración">
        {[4.5, 4, 3].map((r) => (
          <Check
            key={r}
            type="radio"
            name="rating"
            label={
              <span className="inline-flex items-center gap-1">
                {r.toLocaleString('es-EC')} <Star size={14} className="fill-brand-500 text-brand-500" aria-hidden="true" /> o más
              </span>
            }
            checked={filters.minRating === r}
            onChange={() => onChange({ minRating: filters.minRating === r ? null : r })}
          />
        ))}
      </FilterGroup>

      {facets.languages.length > 0 && (
        <FilterGroup title="Idioma del guía">
          {facets.languages.map(([lang, count]) => (
            <Check
              key={lang}
              type="radio"
              name="language"
              label={formatLanguage(lang)}
              count={count}
              checked={filters.language === lang}
              onChange={() => onChange({ language: filters.language === lang ? '' : lang })}
            />
          ))}
        </FilterGroup>
      )}

      <FilterGroup title="Especiales">
        <Check
          label="Cancelación gratuita"
          checked={filters.freeCancellation}
          onChange={() => onChange({ freeCancellation: !filters.freeCancellation })}
        />
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="py-5 first:pt-0">
      <fieldset>
        <legend className="mb-3 text-base font-bold">{title}</legend>
        <div className="space-y-2.5">{children}</div>
      </fieldset>
    </div>
  );
}

interface CheckProps {
  label: ReactNode;
  count?: number;
  checked: boolean;
  onChange: () => void;
  type?: 'checkbox' | 'radio';
  name?: string;
}

function Check({ label, count, checked, onChange, type = 'checkbox', name }: CheckProps) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-[15px]">
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        onClick={type === 'radio' && checked ? onChange : undefined}
        className="h-[18px] w-[18px] shrink-0 accent-[#C94D6B]"
      />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-sm text-ink-muted">{count}</span>}
    </label>
  );
}
