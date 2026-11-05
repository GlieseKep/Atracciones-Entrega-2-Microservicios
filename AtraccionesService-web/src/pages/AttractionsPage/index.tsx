import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import { AttractionFilters } from '@/components/attractions/AttractionFilters';
import { Button } from '@/components/common/Button';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { SearchSummary } from '@/components/search/SearchSummary';
import { Pagination, SearchResults } from '@/components/search/SearchResults';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  parseFilters,
  serializeFilters,
  SORT_OPTIONS,
  type CatalogFilters,
  type SortOption,
} from '@/features/attractions/filters';
import { useAttractions, useCatalogFacets } from '@/hooks/useAttractions';

const LAYOUT_KEY = 'ea.results.layout';

/** Resultados de `POST /atracciones/search` con filtros laterales, orden y paginación del servidor. */
export default function AttractionsPage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const { status, error, retry, data } = useAttractions(filters);
  const facets = useCatalogFacets();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      /* preferencia opcional */
    }
  }, [layout]);

  const update = useCallback(
    (patch: Partial<CatalogFilters>) => {
      const next = { ...filters, ...patch, page: patch.page ?? 1 };
      setParams(serializeFilters(next), { replace: patch.page === undefined });
      if (patch.page) window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [filters, setParams],
  );

  const clear = () => setParams(serializeFilters({ ...DEFAULT_FILTERS, q: filters.q }));
  const place = filters.city || 'Ecuador';
  const count = activeFilterCount(filters);
  const total = data?.metadata.total_results ?? 0;

  const filterPanel = <AttractionFilters filters={filters} facets={facets} onChange={update} />;

  return (
    <div className="page-container pt-4">
      <Breadcrumbs
        items={[
          { label: 'Inicio', to: '/' },
          { label: 'Ecuador', to: '/atracciones' },
          ...(filters.city ? [{ label: filters.city }] : [{ label: 'Cosas que hacer' }]),
        ]}
      />
      <h1 className="mt-4 text-3xl sm:text-4xl">{filters.q ? `Resultados para “${filters.q}”` : `Cosas que hacer en ${place}`}</h1>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[264px_1fr]">
        <aside className="hidden lg:block" aria-label="Filtros">
          {filterPanel}
        </aside>

        <section aria-label="Resultados">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal size={16} aria-hidden="true" /> Filtros{count ? ` (${count})` : ''}
            </Button>
            <p className="text-sm text-ink-soft" role="status" aria-live="polite">
              {status === 'loading' && !data ? 'Buscando…' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Select
                label="Ordenar por"
                hideLabel
                className="w-56"
                value={filters.sort}
                onChange={(e) => update({ sort: e.target.value as SortOption })}
                options={SORT_OPTIONS.map((o) => ({ value: o.value, label: `Ordenar: ${o.label}` }))}
              />
              <div className="hidden rounded-full border border-line p-0.5 sm:flex" role="group" aria-label="Vista">
                {(['grid', 'list'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLayout(l)}
                    aria-pressed={layout === l}
                    aria-label={l === 'grid' ? 'Vista en cuadrícula' : 'Vista en lista'}
                    className={`rounded-full p-2 ${layout === l ? 'bg-ink text-white' : 'hover:bg-surface'}`}
                  >
                    {l === 'grid' ? <LayoutGrid size={16} aria-hidden="true" /> : <List size={16} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <SearchSummary filters={filters} categories={facets.categories} onChange={update} onClear={clear} />
          </div>

          <div className="mt-6">
            {status === 'error' ? (
              <ErrorState error={error} onRetry={retry} />
            ) : data && data.data.length === 0 ? (
              <EmptyState
                title="No encontramos experiencias con esos criterios"
                action={
                  <Button variant="secondary" onClick={clear}>
                    Borrar filtros
                  </Button>
                }
              >
                <ul className="list-disc text-left">
                  <li>Revisa la ortografía o usa términos más generales.</li>
                  <li>Quita algunos filtros o amplía el precio máximo.</li>
                  <li>Prueba con otra fecha o destino cercano.</li>
                </ul>
              </EmptyState>
            ) : (
              <SearchResults items={data?.data ?? []} loading={status === 'loading'} layout={layout} />
            )}
          </div>

          {data && <Pagination page={data.metadata.page} totalPages={data.metadata.total_pages} onPage={(p) => update({ page: p })} />}
        </section>
      </div>

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtros"
        footer={
          <>
            <Button variant="tertiary" onClick={clear}>
              Borrar todo
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Mostrar {total} resultados</Button>
          </>
        }
      >
        {filterPanel}
      </Modal>
    </div>
  );
}
