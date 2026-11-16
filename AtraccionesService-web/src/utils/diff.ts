const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface MergeOptions<T> {
  /** Igualdad de dos versiones del mismo elemento. Por defecto compara su JSON. */
  equal?: (prev: T, next: T) => boolean;
  /** Conserva, en su posición, los elementos previos que ya no vinieron. */
  keepMissing?: boolean;
}

/**
 * Diffing por id para el polling silencioso: los elementos que no cambiaron conservan su objeto previo (y `React.memo`
 * no los vuelve a pintar). Si nada cambió, devuelve el mismo array `prev`.
 */
export function mergeById<T>(prev: T[], next: T[], idOf: (item: T) => string, { equal = sameJson, keepMissing = false }: MergeOptions<T> = {}): T[] {
  const prevById = new Map(prev.map((item) => [idOf(item), item]));
  const nextIds = new Set(next.map(idOf));
  const out = next.map((item) => {
    const old = prevById.get(idOf(item));
    return old !== undefined && equal(old, item) ? old : item;
  });
  if (keepMissing) {
    prev.forEach((item, index) => {
      if (!nextIds.has(idOf(item))) out.splice(Math.min(index, out.length), 0, item);
    });
  }
  return out.length === prev.length && out.every((item, i) => item === prev[i]) ? prev : out;
}

/**
 * Polling silencioso con filtro: los elementos que se muestran y ya no vinieron (p. ej. una reserva confirmada que se
 * canceló mientras se filtra por "Confirmadas") se vuelven a leer uno por uno con `fetchOne` y se insertan en su
 * posición, para que `mergeById` los actualice con su estado real. Si la lectura falla, se conserva el elemento previo.
 */
export async function refreshMissing<T>(
  prev: T[] | undefined,
  next: T[],
  idOf: (item: T) => string,
  fetchOne: (item: T, signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T[]> {
  if (!prev?.length) return next;
  const nextIds = new Set(next.map(idOf));
  const missing = prev.map((item, index) => ({ item, index })).filter(({ item }) => !nextIds.has(idOf(item)));
  if (missing.length === 0) return next;
  const fresh = await Promise.all(missing.map(({ item }) => fetchOne(item, signal).catch(() => item)));
  const out = [...next];
  missing.forEach(({ index }, i) => out.splice(Math.min(index, out.length), 0, fresh[i] ?? missing[i].item));
  return out;
}
