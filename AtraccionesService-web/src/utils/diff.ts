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
