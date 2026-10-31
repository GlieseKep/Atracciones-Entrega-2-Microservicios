import { AppError } from '@atracciones/platform';
import type { BitacoraFilters } from '../contract';

const MAX_LIMIT = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function positive(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw AppError.validation(`'${name}' debe ser un entero positivo.`, [{ name, reason: 'Debe ser un entero positivo.' }]);
  return number;
}

function date(value: unknown, name: string): string | null {
  if (value === undefined) return null;
  const text = String(value);
  // `2026-02-30` se convierte en otro día: al volver a texto ya no coincide.
  if (!DATE.test(text) || Number.isNaN(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) {
    throw AppError.validation(`'${name}' debe ser una fecha AAAA-MM-DD.`, [{ name, reason: 'Debe ser una fecha AAAA-MM-DD.' }]);
  }
  return text;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

export function parseFilters(query: Record<string, unknown>): BitacoraFilters {
  const limit = query.limit === undefined ? 20 : positive(query.limit, 'limit');
  if (limit > MAX_LIMIT) throw AppError.validation(`'limit' no puede superar ${MAX_LIMIT}.`, [{ name: 'limit', reason: `Máximo ${MAX_LIMIT}.` }]);
  const desde = date(query.desde, 'desde');
  const hasta = date(query.hasta, 'hasta');
  if (desde && hasta && desde > hasta) throw AppError.validation("'desde' no puede ser posterior a 'hasta'.", [{ name: 'desde', reason: "No puede ser posterior a 'hasta'." }]);
  return {
    accion: text(query.accion),
    entidad: text(query.entidad),
    entidadId: text(query.entidad_id),
    correlationId: text(query.correlation_id),
    usuId: query.usu_id === undefined ? null : positive(query.usu_id, 'usu_id'),
    desde,
    hasta,
    page: query.page === undefined ? 1 : positive(query.page, 'page'),
    limit,
  };
}
