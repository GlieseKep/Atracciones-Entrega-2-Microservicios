import { AppError, type InvalidParam } from '@atracciones/platform';
import { COUPON_TYPES, type CouponCreate, type CouponPatch, type CouponType, type CouponValidationRequest } from '../contract';

type Body = Record<string, unknown>;

const asBody = (body: unknown): Body => (body && typeof body === 'object' ? (body as Body) : {});
const CODE = /^[A-Z0-9_-]{3,30}$/;

export const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const stop = (errors: InvalidParam[]) => {
  if (errors.length > 0) throw AppError.validation('La solicitud tiene campos inválidos.', errors);
};

const validMaxUses = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) >= 1);

/** Reglas entre campos: `422`, como indica el contrato. */
function assertCoherent(type: CouponType | null, value: number | null, start: string, end: string | null): void {
  if (type === 'PORCENTAJE' && value !== null && value > 100) {
    throw AppError.unprocessable('COUPON_INVALID_VALUE', 'Un porcentaje no puede superar 100.', [{ name: 'value', reason: 'Máximo 100.' }]);
  }
  if (end !== null && end < start) {
    throw AppError.unprocessable('COUPON_INVALID_DATES', 'end_date debe ser igual o posterior a start_date.', [{ name: 'end_date', reason: 'Anterior a start_date.' }]);
  }
}

export function parseCouponCreate(body: unknown): CouponCreate {
  const b = asBody(body);
  const errors: InvalidParam[] = [];
  const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
  if (!CODE.test(code)) errors.push({ name: 'code', reason: 'De 3 a 30 letras mayúsculas, dígitos, guion o guion bajo.' });
  if (!COUPON_TYPES.includes(b.type as CouponType)) errors.push({ name: 'type', reason: `Debe ser ${COUPON_TYPES.join(', ')}.` });
  if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0) errors.push({ name: 'value', reason: 'Debe ser un número no negativo.' });
  if (!isDate(b.start_date)) errors.push({ name: 'start_date', reason: 'Debe ser una fecha YYYY-MM-DD.' });
  const endDate = b.end_date ?? null;
  if (endDate !== null && !isDate(endDate)) errors.push({ name: 'end_date', reason: 'Debe ser una fecha YYYY-MM-DD.' });
  const maxUses = b.max_uses ?? null;
  if (!validMaxUses(maxUses)) errors.push({ name: 'max_uses', reason: 'Debe ser un entero positivo.' });
  if (b.active !== undefined && typeof b.active !== 'boolean') errors.push({ name: 'active', reason: 'Debe ser booleano.' });
  stop(errors);
  assertCoherent(b.type as CouponType, b.value as number, b.start_date as string, endDate as string | null);
  return {
    code,
    type: b.type as CouponType,
    value: b.value as number,
    start_date: b.start_date as string,
    end_date: endDate as string | null,
    max_uses: maxUses as number | null,
    active: b.active !== false,
  };
}

/** El código, el tipo y el valor no cambian: para otro descuento se crea otro cupón. */
export function parseCouponPatch(body: unknown): CouponPatch {
  const b = asBody(body);
  const errors: InvalidParam[] = [];
  const patch: CouponPatch = {};
  if (b.start_date !== undefined) {
    if (isDate(b.start_date)) patch.start_date = b.start_date;
    else errors.push({ name: 'start_date', reason: 'Debe ser una fecha YYYY-MM-DD.' });
  }
  if (b.end_date !== undefined) {
    if (b.end_date === null || isDate(b.end_date)) patch.end_date = b.end_date;
    else errors.push({ name: 'end_date', reason: 'Debe ser una fecha YYYY-MM-DD.' });
  }
  if (b.max_uses !== undefined) {
    if (validMaxUses(b.max_uses)) patch.max_uses = b.max_uses as number | null;
    else errors.push({ name: 'max_uses', reason: 'Debe ser un entero positivo.' });
  }
  if (b.active !== undefined) {
    if (typeof b.active === 'boolean') patch.active = b.active;
    else errors.push({ name: 'active', reason: 'Debe ser booleano.' });
  }
  if (errors.length === 0 && Object.keys(patch).length === 0) errors.push({ name: 'body', reason: 'Envíe al menos un campo modificable.' });
  stop(errors);
  return patch;
}

export const assertDates = (start: string, end: string | null) => assertCoherent(null, null, start, end);

export function parseValidation(body: unknown): CouponValidationRequest {
  const b = asBody(body);
  const errors: InvalidParam[] = [];
  if (typeof b.code !== 'string' || b.code.trim() === '') errors.push({ name: 'code', reason: 'Es obligatorio.' });
  if (typeof b.subtotal !== 'number' || !Number.isFinite(b.subtotal) || b.subtotal < 0) errors.push({ name: 'subtotal', reason: 'Debe ser un número no negativo.' });
  if (b.date !== undefined && !isDate(b.date)) errors.push({ name: 'date', reason: 'Debe ser una fecha YYYY-MM-DD.' });
  if (b.currency !== undefined && (typeof b.currency !== 'string' || !/^[A-Z]{3}$/.test(b.currency))) errors.push({ name: 'currency', reason: 'Debe ser un código de 3 letras.' });
  stop(errors);
  return {
    code: (b.code as string).trim().toUpperCase(),
    subtotal: b.subtotal as number,
    currency: (b.currency as string | undefined) ?? 'USD',
    date: (b.date as string | undefined) ?? null,
  };
}

export function parseCouponQuery(query: Record<string, unknown>): { active: boolean | null; code: string | null; page: number; limit: number } {
  const read = (name: string, fallback: number, max: number) => {
    if (query[name] === undefined) return fallback;
    const value = Number(query[name]);
    if (!Number.isInteger(value) || value < 1 || value > max) throw AppError.validation(`'${name}' debe ser un entero entre 1 y ${max}.`, [{ name, reason: 'Fuera de rango.' }]);
    return value;
  };
  if (query.active !== undefined && query.active !== 'true' && query.active !== 'false') {
    throw AppError.validation("'active' debe ser true o false.", [{ name: 'active', reason: 'Debe ser booleano.' }]);
  }
  return {
    active: query.active === undefined ? null : query.active === 'true',
    code: typeof query.code === 'string' && query.code.trim() !== '' ? query.code.trim() : null,
    page: read('page', 1, Number.MAX_SAFE_INTEGER),
    limit: read('limit', 10, 50),
  };
}
