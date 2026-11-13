import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { AsyncState } from './useAsync';

interface PollingOptions<T> {
  /** Espera entre el fin de una consulta y el inicio de la siguiente. `0` = sin consultas de fondo (como `useAsync`). */
  intervalMs: number;
  enabled?: boolean;
  /**
   * Diffing de las consultas de fondo: recibe lo que se muestra y lo que llegó. Si devuelve `prev` (la misma
   * referencia), no hay cambios y no se vuelve a renderizar.
   */
  merge?: (prev: T, next: T) => T;
}

/**
 * Silent Background Polling. La primera carga (y cada cambio de `deps` o `retry`) es normal: `status: 'loading'`
 * para el skeleton y `status: 'error'` si falla. Después consulta en segundo plano con `isSilent = true`: nunca pasa
 * a `loading`, ignora los fallos (conserva lo último mostrado) y solo actualiza `data` si algo cambió.
 * No solapa consultas (cadena de `setTimeout`) y se pausa mientras la pestaña está oculta.
 */
export function usePolling<T>(
  load: (signal: AbortSignal, isSilent: boolean) => Promise<T>,
  deps: DependencyList,
  { intervalMs, enabled = true, merge }: PollingOptions<T>,
) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  const mergeRef = useRef(merge);
  loadRef.current = load;
  mergeRef.current = merge;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let inFlight = false;
    let loaded = false;

    const schedule = () => {
      clearTimeout(timer);
      if (disposed || document.hidden || intervalMs <= 0) return;
      timer = setTimeout(() => {
        if (!document.hidden) run(true);
      }, intervalMs);
    };

    const run = (isSilent: boolean) => {
      clearTimeout(timer);
      controller?.abort();
      const current = new AbortController();
      controller = current;
      inFlight = true;
      if (!isSilent) setState((prev) => ({ status: 'loading', data: prev.data }));
      loadRef.current(current.signal, isSilent).then(
        (data) => {
          if (current.signal.aborted) return;
          inFlight = false;
          loaded = true;
          setState((prev) => {
            if (isSilent && prev.status === 'success' && mergeRef.current) {
              const merged = mergeRef.current(prev.data, data);
              return merged === prev.data ? prev : { status: 'success', data: merged };
            }
            return { status: 'success', data };
          });
          schedule();
        },
        (error: unknown) => {
          if (current.signal.aborted) return;
          inFlight = false;
          if (!isSilent) {
            setState({ status: 'error', error });
            return;
          }
          schedule();
        },
      );
    };

    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else if (intervalMs > 0 && loaded && !inFlight) run(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    run(false);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, enabled, intervalMs]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
