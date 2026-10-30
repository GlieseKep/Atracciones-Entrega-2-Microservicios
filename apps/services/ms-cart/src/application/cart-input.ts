import { AppError, type InvalidParam } from '@atracciones/platform';
import { slotTime } from './slot';

/** Cantidades por tipo de boleto, con los mismos campos que `CreateReservaRequestV3`. */
export interface TicketCounts {
  adult: number;
  child: number;
  senior: number;
  student: number;
  infant: number;
}

export interface ItemInput {
  attractionId: string;
  slot: string | null;
  counts: TicketCounts;
}

/** Cambios de un ítem: solo los campos enviados. `slot: null` quita el turno. */
export interface ItemPatch {
  slot?: string | null;
  counts: Partial<TicketCounts>;
}

/** Mismo tope de boletos por turno que una reserva del portal. */
export const MAX_TICKETS = 20;

const COUNT_FIELDS: [keyof TicketCounts, string][] = [
  ['adult', 'adult_count'],
  ['child', 'child_count'],
  ['senior', 'senior_count'],
  ['student', 'student_count'],
  ['infant', 'infant_count'],
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ticketTotal = (c: TicketCounts) => c.adult + c.child + c.senior + c.student + c.infant;

const asObject = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw AppError.validation('El cuerpo debe ser un objeto JSON.');
  return body as Record<string, unknown>;
};

/** Lee el `slot_id`: ausente (`undefined`), `null` o un turno con formato `slot-YYYYMMDD-HHmm`. */
function readSlot(body: Record<string, unknown>, invalid: InvalidParam[]): string | null | undefined {
  if (!('slot_id' in body) || body.slot_id === undefined) return undefined;
  if (body.slot_id === null) return null;
  if (typeof body.slot_id !== 'string' || !slotTime(body.slot_id)) {
    invalid.push({ name: 'slot_id', reason: 'Formato slot-YYYYMMDD-HHmm con una fecha y hora válidas.' });
    return undefined;
  }
  return body.slot_id;
}

/** Lee las cantidades enviadas: deben ser enteros (si no, 400). */
function readCounts(body: Record<string, unknown>, invalid: InvalidParam[]): Partial<TicketCounts> {
  const counts: Partial<TicketCounts> = {};
  for (const [key, field] of COUNT_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'number' || !Number.isInteger(body[field])) invalid.push({ name: field, reason: 'Debe ser un número entero.' });
    else counts[key] = body[field] as number;
  }
  return counts;
}

/**
 * Reglas semánticas (422): al menos un adulto, ninguna cantidad negativa y como máximo `MAX_TICKETS` boletos por ítem.
 */
export function checkCounts(counts: TicketCounts): void {
  const invalid: InvalidParam[] = [];
  if (counts.adult < 1) invalid.push({ name: 'adult_count', reason: 'Debe ser mayor o igual a 1.' });
  for (const [key, field] of COUNT_FIELDS) {
    if (key !== 'adult' && counts[key] < 0) invalid.push({ name: field, reason: 'Debe ser mayor o igual a 0.' });
  }
  if (!invalid.length && ticketTotal(counts) > MAX_TICKETS) invalid.push({ name: 'adult_count', reason: `Máximo ${MAX_TICKETS} boletos por ítem.` });
  if (invalid.length) throw AppError.unprocessable('SEMANTIC_VALIDATION_FAILED', 'Las cantidades de boletos no son válidas.', invalid);
}

/** `CartItemRequest`: errores de tipo o formato → 400; reglas de negocio de las cantidades → 422. */
export function parseItem(value: unknown): ItemInput {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  const attractionId = typeof body.attraction_id === 'string' ? body.attraction_id.trim() : '';
  if (!attractionId || attractionId.length > 220) invalid.push({ name: 'attraction_id', reason: 'ID público, slug o UUID de la atracción.' });
  const slot = readSlot(body, invalid);
  const sent = readCounts(body, invalid);
  if (body.adult_count === undefined) invalid.push({ name: 'adult_count', reason: 'Es obligatorio.' });
  if (invalid.length) throw AppError.validation('El ítem del carrito no es válido.', invalid);
  const counts: TicketCounts = { adult: sent.adult ?? 0, child: sent.child ?? 0, senior: sent.senior ?? 0, student: sent.student ?? 0, infant: sent.infant ?? 0 };
  checkCounts(counts);
  return { attractionId, slot: slot ?? null, counts };
}

/** `CartItemUpdateRequest`: al menos un campo conocido. Las cantidades se validan al combinarlas con las del ítem. */
export function parseItemPatch(value: unknown): ItemPatch {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  const slot = readSlot(body, invalid);
  const counts = readCounts(body, invalid);
  if (invalid.length) throw AppError.validation('Los cambios del ítem no son válidos.', invalid);
  if (slot === undefined && Object.keys(counts).length === 0) {
    throw AppError.validation('Envíe al menos un campo para cambiar.', [{ name: 'body', reason: 'slot_id o alguna cantidad de boletos.' }]);
  }
  return slot === undefined ? { counts } : { slot, counts };
}

/** `CartItemOrderRequest`: la orden de Order (`external_order_id`). */
export function parseOrderNumber(value: unknown): string {
  const body = asObject(value);
  const number = typeof body.external_order_id === 'string' ? body.external_order_id.trim() : '';
  if (!number || number.length > 20) {
    throw AppError.validation('Falta la orden del ítem.', [{ name: 'external_order_id', reason: 'Texto de 1 a 20 caracteres (orden.ord_numero).' }]);
  }
  return number;
}

/** Cabecera `Idempotency-Key` obligatoria (UUID v4). */
export function parseIdempotencyKey(value: unknown): string {
  const key = Array.isArray(value) ? value[0] : value;
  if (typeof key !== 'string' || !UUID.test(key)) {
    throw AppError.validation('La cabecera Idempotency-Key es obligatoria.', [{ name: 'Idempotency-Key', reason: 'UUID v4.' }]);
  }
  return key.toLowerCase();
}

/** Identificador numérico de la ruta (`cart_id`, `item_id`); `null` si no lo es. */
export function parseId(value: string): string | null {
  return /^[1-9]\d{0,17}$/.test(value) ? value : null;
}
