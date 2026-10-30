import { AppError, paging, SOLICITANTES_CANCELACION, type InvalidParam, type Paging } from '@atracciones/platform';
import type { RefundStatus, Solicitante } from '../contract';

export interface RefundRequest {
  paymentKey: string;
  idempotencyKey: string;
  amount: number | null;
  reason: string;
  requester: Solicitante;
}

export interface RefundFilters extends Paging {
  status: RefundStatus | null;
  from: string | null;
  to: string | null;
}

const STATUSES: RefundStatus[] = ['PENDIENTE', 'EMITIDO', 'FALLIDO'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Límite de `dom_importe` (numeric 12,2). */
const MAX_AMOUNT = 9_999_999_999.99;
export const DEFAULT_REASON = 'Cancelación de la reserva';

const asObject = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw AppError.validation('El cuerpo debe ser un objeto JSON.');
  return body as Record<string, unknown>;
};

/** Primer valor de un parámetro de query (`?a=1&a=2` → `'1'`). */
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const isDate = (value: unknown): value is string => typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** `RefundRequest`. El solicitante por defecto es `CLIENTE`, como en Payment. */
export function parseRefundRequest(value: unknown): RefundRequest {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  const key = (name: string) => {
    const raw = body[name];
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 120) {
      invalid.push({ name, reason: 'Texto de 1 a 120 caracteres.' });
      return '';
    }
    return raw.trim();
  };
  const paymentKey = key('clave_pago');
  const idempotencyKey = key('clave_idempotencia');
  let amount: number | null = null;
  if (body.monto !== undefined && body.monto !== null) {
    if (typeof body.monto !== 'number' || !Number.isFinite(body.monto) || body.monto <= 0 || body.monto > MAX_AMOUNT) {
      invalid.push({ name: 'monto', reason: 'Número mayor que 0.' });
    } else amount = body.monto;
  }
  let reason = DEFAULT_REASON;
  if (body.motivo !== undefined && body.motivo !== null) {
    if (typeof body.motivo !== 'string' || body.motivo.length > 300) invalid.push({ name: 'motivo', reason: 'Texto de hasta 300 caracteres.' });
    else reason = body.motivo.trim() || DEFAULT_REASON;
  }
  const requester = (body.solicitante ?? 'CLIENTE') as Solicitante;
  if (!SOLICITANTES_CANCELACION.includes(requester)) invalid.push({ name: 'solicitante', reason: `Uno de ${SOLICITANTES_CANCELACION.join(', ')}.` });
  if (invalid.length) throw AppError.validation('Reembolso inválido: se requieren clave_pago, clave_idempotencia y un solicitante válido.', invalid);
  return { paymentKey, idempotencyKey, amount, reason, requester };
}

/** Query de `GET /reembolsos`. */
export function parseRefundFilters(query: Record<string, unknown>): RefundFilters {
  const invalid: InvalidParam[] = [];
  const statusRaw = first(query.estado);
  let status: RefundStatus | null = null;
  if (statusRaw !== undefined && statusRaw !== '') {
    if (!STATUSES.includes(statusRaw as RefundStatus)) invalid.push({ name: 'estado', reason: `Uno de ${STATUSES.join(', ')}.` });
    else status = statusRaw as RefundStatus;
  }
  const date = (name: 'desde' | 'hasta') => {
    const raw = first(query[name]);
    if (raw === undefined || raw === '') return null;
    if (!isDate(raw)) {
      invalid.push({ name, reason: 'Fecha YYYY-MM-DD.' });
      return null;
    }
    return raw;
  };
  const from = date('desde');
  const to = date('hasta');
  if (invalid.length) throw AppError.validation('Los filtros no son válidos.', invalid);
  return { status, from, to, ...paging({ limit: first(query.limit), offset: first(query.offset) }, 20, 100) };
}

/** Cuerpo de `POST /reembolsos/pagos`; se quitan los repetidos. */
export function parsePaymentIds(value: unknown): string[] {
  const ids = asObject(value).pago_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || !ids.every(isUuid)) {
    throw AppError.validation('La lista de pagos no es válida.', [{ name: 'pago_ids', reason: 'Entre 1 y 200 UUID.' }]);
  }
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}
