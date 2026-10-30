/** Paginación por desplazamiento de los listados internos (portal y administración, no del contrato con Booking). */
export interface Paging {
  limit: number;
  offset: number;
}

/** Página de resultados: el total de coincidencias y los elementos pedidos. */
export interface Page<T> {
  total: number;
  items: T[];
}

/** Lee `limit` (1..max) y `offset` (≥ 0) de una query HTTP o de un mensaje gRPC; valores inválidos toman el defecto. */
export function paging(input: { limit?: unknown; offset?: unknown }, defaultLimit = 20, maxLimit = 200): Paging {
  const limit = Number(input.limit);
  const offset = Number(input.offset);
  return {
    limit: Number.isInteger(limit) && limit >= 1 ? Math.min(limit, maxLimit) : defaultLimit,
    offset: Number.isInteger(offset) && offset >= 0 ? offset : 0,
  };
}

/** Texto opcional de una query o mensaje: vacío o ausente = `null`. */
export const optionalText = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
