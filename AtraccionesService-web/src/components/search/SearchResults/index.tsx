import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AttractionCard, AttractionCardSkeleton } from '@/components/attractions/AttractionCard';
import { usePagination } from '@/hooks/usePagination';
import type { Attraction } from '@/types/attraction';

interface Props {
  items: Attraction[];
  loading: boolean;
  layout: 'grid' | 'list';
}

export function SearchResults({ items, loading, layout }: Props) {
  if (loading && !items.length) {
    return (
      <div className={layout === 'list' ? 'space-y-4' : 'grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3'} aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <AttractionCardSkeleton key={i} layout={layout} />
        ))}
        <span className="sr-only" role="status">
          Cargando resultados…
        </span>
      </div>
    );
  }
  return (
    <ul
      className={`fade-in ${layout === 'list' ? 'space-y-4' : 'grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3'} ${loading ? 'opacity-60' : ''}`}
    >
      {items.map((a) => (
        <li key={a.id}>
          <AttractionCard attraction={a} layout={layout} />
        </li>
      ))}
    </ul>
  );
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  const { pages, hasPrev, hasNext } = usePagination(page, totalPages);
  if (totalPages <= 1) return null;
  const btn = 'inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm font-semibold';
  return (
    <nav aria-label="Paginación" className="mt-10 flex items-center justify-center gap-1">
      <button type="button" className={`${btn} hover:bg-surface disabled:opacity-40`} disabled={!hasPrev} onClick={() => onPage(page - 1)} aria-label="Página anterior">
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      {pages.map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="px-2 text-ink-muted" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`${btn} ${p === page ? 'bg-ink text-white' : 'hover:bg-surface'}`}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" className={`${btn} hover:bg-surface disabled:opacity-40`} disabled={!hasNext} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </nav>
  );
}
