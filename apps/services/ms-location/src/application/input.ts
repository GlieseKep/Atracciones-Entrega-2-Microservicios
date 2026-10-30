import { AppError } from '@atracciones/platform';

const invalid = (name: string, reason: string) => AppError.validation(`'${name}' no es válido: ${reason}`, [{ name, reason }]);

export function parseId(value: unknown, name = 'id'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > 32767) throw invalid(name, 'Debe ser un entero positivo.');
  return id;
}

export function parseCityFilters(query: Record<string, unknown>): { q: string | null; provinciaId: number | null } {
  const q = typeof query.q === 'string' && query.q.trim() !== '' ? query.q.trim() : null;
  if (q !== null && q.length > 80) throw invalid('q', 'Máximo 80 caracteres.');
  return { q, provinciaId: query.provincia_id === undefined ? null : parseId(query.provincia_id, 'provincia_id') };
}

export function parseIds(body: unknown): number[] {
  const ids = (body as { ids?: unknown } | undefined)?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200) throw invalid('ids', 'Debe tener entre 1 y 200 elementos.');
  return [...new Set(ids.map((id) => parseId(id, 'ids')))];
}

export function parseNames(body: unknown): string[] {
  const nombres = (body as { nombres?: unknown } | undefined)?.nombres;
  if (!Array.isArray(nombres) || nombres.length < 1 || nombres.length > 100) throw invalid('nombres', 'Debe tener entre 1 y 100 elementos.');
  if (nombres.some((nombre) => typeof nombre !== 'string' || nombre.trim() === '' || nombre.length > 80)) {
    throw invalid('nombres', 'Cada nombre debe ser texto de hasta 80 caracteres.');
  }
  return nombres as string[];
}
