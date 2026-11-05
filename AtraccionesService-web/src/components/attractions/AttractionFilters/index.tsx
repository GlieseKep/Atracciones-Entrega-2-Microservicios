import { useId, type ReactNode } from 'react';
import { DURATION_OPTIONS, INCLUSION_OPTIONS, type CatalogFilters } from '@/features/attractions/filters';
import type { Category } from '@/types/attraction';
import type { City } from '@/types/location';
import { today } from '@/utils/dates';
import { formatMoney } from '@/utils/formatters';

export interface FilterFacets {
  categories: Category[];
  cities: City[];
  languages: { codigo: string; nombre: string }[];
}

interface Props {
  filters: CatalogFilters;
  facets: FilterFacets;
  onChange: (patch: Partial<CatalogFilters>) => void;
}

const PRICE_CEILING = 200;

/** Panel lateral de filtros. Todos se aplican en `POST /atracciones/search`. */
export function AttractionFilters({ filters, facets, onChange }: Props) {
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const dateId = useId();
  const priceId = useId();
  const cityId = useId();

  return (
    <div className="divide-y divide-line">
      <FilterGroup title="¿Cuándo viajas?">
        <label htmlFor={dateId} className="sr-only">
          Fecha de la actividad
        </label>
        <input id={dateId} type="date" min={today()} value={filters.date} onChange={(e) => onChange({ date: e.target.value })} className="field-input" />
        {filters.date && <p className="text-xs text-ink-muted">Solo experiencias con cupos ese día.</p>}
      </FilterGroup>

      {facets.cities.length > 0 && (
        <FilterGroup title="Destino">
          <label htmlFor={cityId} className="sr-only">
            Ciudad
          </label>
          <select id={cityId} value={filters.city} onChange={(e) => onChange({ city: e.target.value })} className="field-input">
            <option value="">Todo Ecuador</option>
            {facets.cities.map((c) => (
              <option key={c.id} value={c.nombre}>
                {c.nombre} ({c.provincia.nombre})
              </option>
            ))}
          </select>
        </FilterGroup>
      )}

      {facets.categories.length > 0 && (
        <FilterGroup title="Categoría">
          {facets.categories.map((c) => (
            <Check
              key={c.id}
              type="radio"
              name="category"
              label={c.nombre}
              checked={filters.category === c.id}
              onChange={() => onChange({ category: filters.category === c.id ? '' : c.id })}
            />
          ))}
        </FilterGroup>
      )}

      <FilterGroup title="Precio por adulto">
        <label htmlFor={priceId} className="flex justify-between text-sm">
          <span>Precio máximo</span>
          <span className="font-semibold">{filters.maxPrice ? formatMoney(filters.maxPrice) : 'Cualquiera'}</span>
        </label>
        <input
          id={priceId}
          type="range"
          min={10}
          max={PRICE_CEILING}
          step={5}
          value={filters.maxPrice ?? PRICE_CEILING}
          onChange={(e) => {
            const value = Number(e.target.value);
            onChange({ maxPrice: value >= PRICE_CEILING ? null : value });
          }}
          className="mt-3 w-full accent-[#C94D6B]"
        />
        <div className="flex justify-between text-xs text-ink-muted">
          <span>{formatMoney(10)}</span>
          <span>{formatMoney(PRICE_CEILING)}+</span>
        </div>
      </FilterGroup>

      <FilterGroup title="Duración">
        {DURATION_OPTIONS.map((o) => (
          <Check
            key={o.value}
            type="radio"
            name="duration"
            label={o.label}
            checked={filters.maxHours === o.value}
            onChange={() => onChange({ maxHours: filters.maxHours === o.value ? null : o.value })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Qué incluye">
        {INCLUSION_OPTIONS.map((o) => (
          <Check key={o.value} label={o.label} checked={filters.includes.includes(o.value)} onChange={() => onChange({ includes: toggle(filters.includes, o.value) })} />
        ))}
      </FilterGroup>

      {facets.languages.length > 0 && (
        <FilterGroup title="Idioma del guía">
          {facets.languages.map((l) => (
            <Check
              key={l.codigo}
              type="radio"
              name="language"
              label={l.nombre}
              checked={filters.language === l.nombre}
              onChange={() => onChange({ language: filters.language === l.nombre ? '' : l.nombre })}
            />
          ))}
        </FilterGroup>
      )}

      <FilterGroup title="Especiales">
        <Check label="Cancelación gratuita" checked={filters.freeCancellation} onChange={() => onChange({ freeCancellation: !filters.freeCancellation })} />
        <Check label="Apto para silla de ruedas" checked={filters.accessible} onChange={() => onChange({ accessible: !filters.accessible })} />
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
  checked: boolean;
  onChange: () => void;
  type?: 'checkbox' | 'radio';
  name?: string;
}

function Check({ label, checked, onChange, type = 'checkbox', name }: CheckProps) {
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
    </label>
  );
}
