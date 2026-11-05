import { useEffect, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Pagination } from '@/components/search/SearchResults';
import { useAsync } from '@/hooks/useAsync';
import type { AdminPage } from '@/types/admin';
import { errorMessage } from '@/utils/api';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
}

/** Filtros de la tabla. Cada pantalla los traduce a los nombres de su servicio. */
export interface TableParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  from?: string;
  to?: string;
}

interface Props<T> {
  title: string;
  /** Carga una página con los filtros actuales. */
  load: (params: TableParams, signal: AbortSignal) => Promise<AdminPage<T>>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Sin `searchPlaceholder` no se muestra el buscador (no todos los servicios buscan por texto). */
  searchPlaceholder?: string;
  statuses?: { value: string; label: string }[];
  /** Etiqueta del filtro de `status` (por defecto, Estado). */
  statusLabel?: string;
  /** Muestra filtros de fecha (`from`, `to`) con esta etiqueta. */
  dateLabel?: string;
  extraFilters?: ReactNode;
  /** Valores extra que fuerzan recargar desde la página 1 cuando cambian. */
  extraKey?: string;
  actions?: ReactNode;
  /** Cambiarlo fuerza a recargar la página actual (después de editar una fila). */
  reloadKey?: number;
  pageSize?: number;
  /** Encabezado propio (en pestañas no hace falta el título grande). */
  hideTitle?: boolean;
}

/** Tabla administrativa: búsqueda con espera, filtro de estado, rango de fechas y paginación en el servidor. */
export function AdminTable<T>({
  title,
  load,
  columns,
  rowKey,
  searchPlaceholder,
  statuses,
  statusLabel = 'Estado',
  dateLabel,
  extraFilters,
  extraKey = '',
  actions,
  reloadKey = 0,
  pageSize = 15,
  hideTitle = false,
}: Props<T>) {
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const filters = JSON.stringify({ search, status, from, to, extraKey });
  useEffect(() => setPage(1), [filters]);

  const result = useAsync(
    (signal) =>
      load({ page, limit: pageSize, search: search || undefined, status: status || undefined, from: from || undefined, to: to || undefined }, signal),
    [page, filters, reloadKey],
  );
  const totalPages = Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize));

  return (
    <div>
      {(!hideTitle || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!hideTitle ? <h1 className="text-3xl">{title}</h1> : <span />}
          {actions}
        </div>
      )}

      {(searchPlaceholder || statuses || dateLabel || extraFilters) && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {searchPlaceholder && (
            <Input
              label="Buscar"
              type="search"
              placeholder={searchPlaceholder}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              icon={<Search size={16} />}
              maxLength={100}
            />
          )}
          {statuses && (
            <Select label={statusLabel} value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Todos' }, ...statuses]} />
          )}
          {dateLabel && (
            <>
              <Input label={`${dateLabel} desde`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input label={`${dateLabel} hasta`} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
          {extraFilters}
        </div>
      )}

      <div className="mt-6">
        {result.status === 'error' ? (
          <ErrorState error={result.error} onRetry={result.retry} />
        ) : !result.data ? (
          <div className="skeleton h-72" aria-busy="true" />
        ) : result.data.items.length === 0 ? (
          <EmptyState title="No hay resultados">Prueba con otros filtros.</EmptyState>
        ) : (
          <>
            <p className="mb-2 text-sm text-ink-soft" aria-live="polite">
              {result.data.total.toLocaleString('es-EC')} {result.data.total === 1 ? 'resultado' : 'resultados'}
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
                  {result.data.items.map((row) => (
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
            <Pagination page={page} totalPages={totalPages} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

/** Texto secundario bajo un valor principal en una celda. */
export const Sub = ({ children }: { children: ReactNode }) => <span className="block text-xs text-ink-muted">{children}</span>;

/** Ejecuta una acción de fila mostrando el error o el aviso de éxito. */
export function useRowAction(onDone: () => void, notify: (message: string, tone?: 'success' | 'error' | 'info') => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      notify(success, 'success');
      onDone();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
