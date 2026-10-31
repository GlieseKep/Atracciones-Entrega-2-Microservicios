import { useCallback, useEffect, useState, type DependencyList } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data?: T; error?: undefined }
  | { status: 'success'; data: T; error?: undefined }
  | { status: 'error'; data?: T; error: unknown };

/** Ejecuta una carga cancelable y expone `retry` para los botones "Volver a intentar" (plan §16). */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList, enabled = true) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((prev) => ({ status: 'loading', data: prev.data }));
    load(controller.signal).then(
      (data) => !controller.signal.aborted && setState({ status: 'success', data }),
      (error: unknown) => !controller.signal.aborted && setState({ status: 'error', error }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, enabled]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback((data: T) => setState({ status: 'success', data }), []);
  return { ...state, retry, setData };
}
