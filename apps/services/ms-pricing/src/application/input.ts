import { AppError, TIPOS_BOLETO } from '@atracciones/platform';
import type { TicketType } from '../contract';

const CODE = /^[A-Za-z0-9]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
/** Límite de `dom_importe` (numeric 12,2). */
const MAX_PRICE = 9_999_999_999.99;
/** Atracciones por consulta en lote. */
export const MAX_BATCH = 100;

/** ID público de la atracción (código de 12 caracteres de Catalog). */
export function requireCode(value: unknown, name = 'attraction_id'): string {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!CODE.test(code)) throw AppError.validation(`'${name}' debe ser el ID público de 12 caracteres de la atracción.`, [{ name, reason: 'Código alfanumérico de 12 caracteres.' }]);
  return code;
}

/** Fecha real `YYYY-MM-DD`; vacía → `fallback`. */
export function dateOr(value: unknown, fallback: string, name: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = new Date(`${String(value)}T00:00:00Z`);
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw AppError.validation(`'${name}' debe ser una fecha YYYY-MM-DD.`, [{ name, reason: 'Formato YYYY-MM-DD.' }]);
  }
  return value;
}

/** Fecha opcional: vacía → `null` (p. ej. `valid_to` sin fin). */
export const optionalDate = (value: unknown, name: string): string | null => (value ? dateOr(value, '', name) : null);

export function requireTicketType(value: unknown, name = 'ticket_type'): TicketType {
  if (!TIPOS_BOLETO.includes(value as TicketType)) throw AppError.validation(`'${name}' no es un tipo de boleto válido.`, [{ name, reason: `Uno de ${TIPOS_BOLETO.join(', ')}.` }]);
  return value as TicketType;
}

/** Precio con hasta dos decimales; `ADULT` debe ser mayor que 0 (el resto puede ser 0, p. ej. INFANT). */
export function requirePrice(value: unknown, type: TicketType, name = 'price'): number {
  const n = typeof value === 'number' ? value : NaN;
  const twoDecimals = Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE || !twoDecimals || (type === 'ADULT' && n <= 0)) {
    throw AppError.validation(`El precio ${type} no es válido.`, [{ name, reason: type === 'ADULT' ? 'Mayor que 0, con hasta dos decimales.' : 'Mayor o igual a 0, con hasta dos decimales.' }]);
  }
  return n;
}

export function currencyOr(value: unknown, fallback = 'USD'): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !CURRENCY.test(value)) throw AppError.validation(`'currency' debe ser un código ISO de 3 letras.`, [{ name: 'currency', reason: 'Por ejemplo USD.' }]);
  return value;
}

/** Cantidades de `QuoteTicketsRequest`: al menos un adulto (como `adult_count` del contrato) y el resto ≥ 0. */
export function requireCounts(req: Record<string, unknown>): Record<TicketType, number> {
  const read = (field: string) => (req[field] === undefined || req[field] === null ? 0 : Number(req[field]));
  const counts: Record<TicketType, number> = {
    ADULT: read('adult_count'),
    CHILD: read('child_count'),
    SENIOR: read('senior_count'),
    STUDENT: read('student_count'),
    INFANT: read('infant_count'),
  };
  const invalid = Object.entries(counts)
    .filter(([type, n]) => !Number.isInteger(n) || n < 0 || (type === 'ADULT' && n < 1))
    .map(([type]) => ({ name: `${type.toLowerCase()}_count`, reason: type === 'ADULT' ? 'Entero mayor o igual a 1.' : 'Entero mayor o igual a 0.' }));
  if (invalid.length) throw AppError.validation('Las cantidades de boletos no son válidas.', invalid);
  return counts;
}
