import { AppError, parseSlotId, type InvalidParam } from '@atracciones/platform';
import type { CartItemInput, CartItemPatch, TicketCounts } from '../contract';

type Body = Record<string, unknown>;

const asBody = (body: unknown): Body => (body && typeof body === 'object' ? (body as Body) : {});
const COUNT_FIELDS = ['adult_count', 'child_count', 'senior_count', 'student_count', 'infant_count'] as const;

function readSlot(value: unknown, errors: InvalidParam[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !parseSlotId(value)) {
    errors.push({ name: 'slot_id', reason: 'Debe tener el formato slot-YYYYMMDD-HHMM.' });
    return null;
  }
  return value;
}

/** Un tipo erróneo es `400`; una cantidad fuera de rango, `422`, como `CreateReservaRequestV3`. */
function readCounts(b: Body, errors: InvalidParam[], required: boolean): Partial<TicketCounts> {
  const counts: Partial<TicketCounts> = {};
  for (const field of COUNT_FIELDS) {
    const value = b[field];
    if (value === undefined) {
      if (required && field === 'adult_count') errors.push({ name: field, reason: 'Es obligatorio.' });
      continue;
    }
    if (!Number.isInteger(value)) errors.push({ name: field, reason: 'Debe ser un entero.' });
    else counts[field] = value as number;
  }
  return counts;
}

function assertRanges(counts: Partial<TicketCounts>): void {
  const problems: InvalidParam[] = [];
  if (counts.adult_count !== undefined && counts.adult_count < 1) problems.push({ name: 'adult_count', reason: 'Debe ser 1 o más.' });
  for (const field of COUNT_FIELDS.slice(1)) {
    if ((counts[field] ?? 0) < 0) problems.push({ name: field, reason: 'No puede ser negativo.' });
  }
  if (problems.length > 0) throw AppError.unprocessable('INVALID_TICKET_COUNT', 'Las cantidades de boletos no son válidas.', problems);
}

const stop = (errors: InvalidParam[]) => {
  if (errors.length > 0) throw AppError.validation('La solicitud tiene campos inválidos.', errors);
};

export function parseCartItem(body: unknown): CartItemInput {
  const b = asBody(body);
  const errors: InvalidParam[] = [];
  const attractionId = typeof b.attraction_id === 'string' ? b.attraction_id.trim() : '';
  if (attractionId === '') errors.push({ name: 'attraction_id', reason: 'Es obligatorio.' });
  const slotId = readSlot(b.slot_id, errors);
  const counts = readCounts(b, errors, true);
  stop(errors);
  assertRanges(counts);
  return {
    attraction_id: attractionId,
    slot_id: slotId,
    adult_count: counts.adult_count as number,
    child_count: counts.child_count ?? 0,
    senior_count: counts.senior_count ?? 0,
    student_count: counts.student_count ?? 0,
    infant_count: counts.infant_count ?? 0,
  };
}

export function parseCartItemPatch(body: unknown): CartItemPatch {
  const b = asBody(body);
  const errors: InvalidParam[] = [];
  const patch: CartItemPatch = readCounts(b, errors, false);
  if (b.slot_id !== undefined) patch.slot_id = readSlot(b.slot_id, errors);
  if (errors.length === 0 && Object.keys(patch).length === 0) errors.push({ name: 'body', reason: 'Envíe al menos un campo.' });
  stop(errors);
  assertRanges(patch);
  return patch;
}

export function parseItemId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation("'item_id' debe ser un entero positivo.", [{ name: 'item_id', reason: 'Debe ser un entero positivo.' }]);
  return id;
}

export function parseUserId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation("'usu_id' debe ser un entero positivo.", [{ name: 'usu_id', reason: 'Debe ser un entero positivo.' }]);
  return id;
}

export function parseOrderNumber(body: unknown): string {
  const value = asBody(body).external_order_id;
  if (typeof value !== 'string' || value.trim() === '' || value.length > 20) {
    throw AppError.validation("'external_order_id' es obligatorio, de hasta 20 caracteres.", [{ name: 'external_order_id', reason: 'Es obligatorio.' }]);
  }
  return value.trim();
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw AppError.validation('Idempotency-Key debe ser un UUID.', [{ name: 'Idempotency-Key', reason: 'Debe ser un UUID.' }]);
  }
  return value.toLowerCase();
}
