import { AppError, type InvalidParam } from '@atracciones/platform';
import type { ReembolsoInput } from '../contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRefund(body: unknown): ReembolsoInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: InvalidParam[] = [];
  if (!Number.isSafeInteger(b.ord_id) || (b.ord_id as number) < 1) errors.push({ name: 'ord_id', reason: 'Debe ser un entero positivo.' });
  if (b.monto !== undefined && b.monto !== null && (typeof b.monto !== 'number' || !Number.isFinite(b.monto) || b.monto <= 0)) {
    errors.push({ name: 'monto', reason: 'Debe ser mayor que 0.' });
  }
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  if (motivo.length > 300) errors.push({ name: 'motivo', reason: 'Máximo 300 caracteres.' });
  if (errors.length > 0) throw AppError.validation('El reembolso tiene campos inválidos.', errors);
  return { ord_id: b.ord_id as number, monto: (b.monto as number | null | undefined) ?? null, motivo: motivo || null };
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw AppError.validation('Idempotency-Key debe ser un UUID.', [{ name: 'Idempotency-Key', reason: 'Debe ser un UUID.' }]);
  return value.toLowerCase();
}

export function parseRefundQuery(query: Record<string, unknown>): { pagId: number | null; page: number; limit: number } {
  const read = (name: string, fallback: number, max: number) => {
    if (query[name] === undefined) return fallback;
    const value = Number(query[name]);
    if (!Number.isInteger(value) || value < 1 || value > max) throw AppError.validation(`'${name}' debe ser un entero entre 1 y ${max}.`, [{ name, reason: 'Fuera de rango.' }]);
    return value;
  };
  return { pagId: query.pag_id === undefined ? null : read('pag_id', 0, Number.MAX_SAFE_INTEGER), page: read('page', 1, Number.MAX_SAFE_INTEGER), limit: read('limit', 10, 50) };
}
