import { useEffect, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import type { AdminListParams } from '@/api/admin';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Pagination } from '@/components/search/SearchResults';
import { useAsync } from '@/hooks/useAsync';
import type { PagedResponse } from '@/types/api';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
}

interface Props<T> {
  title: string;
  /** Carga una página con los filtros actuales. */
  load: (params: AdminListParams, signal: AbortSignal) => Promise<PagedResponse<T>>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  statuses?: { value: string; label: string }[];
  /** Etiqueta del filtro de `status` (por defecto, Estado). */
  statusLabel?: string;
  /** Muestra filtros de fecha (`fromDate`, `toDate`) con esta etiqueta. */
  dateLabel?: string;
  extraFilters?: ReactNode;
  extraParams?: AdminListParams;
  actions?: ReactNode;
  /** Cambiarlo fuerza a recargar la página actual (después de editar una fila). */
  reloadKey?: number;
  pageSize?: number;
}

/** Tabla administrativa: búsqueda con espera, filtro de estado, rango de fechas y paginación en el servidor. */
export function AdminTable<T>({
  title,
  load,
  columns,
  rowKey,
  searchPlaceholder = 'Buscar',
  statuses,
  statusLabel = 'Estado',
  dateLabel,
  extraFilters,
  extraParams,
  actions,
  reloadKey = 0,
  pageSize = 15,
}: Props<T>) {
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const filters = JSON.stringify({ search, status, fromDate, toDate, ...extraParams });
  useEffect(() => setPage(1), [filters]);

  const result = useAsync(
    (signal) =>
      load(
        {
          limit: pageSize,
          offset: (page - 1) * pageSize,
          search: search || undefined,
          status: status || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          ...extraParams,
        },
        signal,
      ),
    [page, filters, reloadKey],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">{title}</h1>
        {actions}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Input
          label="Buscar"
          type="search"
          placeholder={searchPlaceholder}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          icon={<Search size={16} />}
          maxLength={100}
        />
        {statuses && (
          <Select
            label={statusLabel}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[{ value: '', label: 'Todos' }, ...statuses]}
          />
        )}
        {dateLabel && (
          <>
            <Input label={`${dateLabel} desde`} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <Input label={`${dateLabel} hasta`} type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </>
        )}
        {extraFilters}
      </div>

      <div className="mt-6">
        {result.status === 'error' ? (
          <ErrorState error={result.error} onRetry={result.retry} />
        ) : !result.data ? (
          <div className="skeleton h-72" aria-busy="true" />
        ) : result.data.data.length === 0 ? (
          <EmptyState title="No hay resultados">Prueba con otros filtros.</EmptyState>
        ) : (
          <>
            <p className="mb-2 text-sm text-ink-soft" aria-live="polite">
              {result.data.totalItems.toLocaleString('es-EC')} {result.data.totalItems === 1 ? 'resultado' : 'resultados'}
            </p>
            <div className={`overflow-x-auto rounded-md border border-line ${result.status === 'loading' ? 'opacity-60' : ''}`}>
              <table className="w-full min-w-[760px] text-left text-sm">
                <caption className="sr-only">{title}</caption>
                <thead className="bg-surface text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    {columns.map((c) => (
                      <th key={c.header} scope="col" className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.data.data.map((row) => (
                    <tr key={rowKey(row)} className="align-top hover:bg-brand-50/50">
                      {columns.map((c) => (
                        <td key={c.header} className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={result.data.totalPages} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

/** Texto secundario bajo un valor principal en una celda. */
export const Sub = ({ children }: { children: ReactNode }) => <span className="block text-xs text-ink-muted">{children}</span>;
