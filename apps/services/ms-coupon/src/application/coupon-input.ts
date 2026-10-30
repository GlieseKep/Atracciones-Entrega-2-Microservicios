import { AppError, type InvalidParam } from '@atracciones/platform';
import type { CouponType } from '../contract';
import { isDate } from './dates';
import { hasAtMostTwoDecimals } from './numbers';

export interface CouponCreate {
  code: string;
  type: CouponType;
  value: number;
  startDate: string;
  endDate: string | null;
  maxUses: number | null;
  active: boolean;
}

/** Cambios permitidos de un cupón: código, tipo y valor no cambian (las órdenes emitidas los usan). */
export interface CouponPatch {
  startDate?: string;
  endDate?: string | null;
  maxUses?: number | null;
  active?: boolean;
}

export interface CouponFilters {
  active: boolean | null;
  code: string | null;
  page: number;
  limit: number;
}

export interface ValidationInput {
  code: string;
  subtotal: number;
  currency: string;
  date: string | null;
}

const CODE = /^[A-Z0-9_-]{3,30}$/;
const TYPES: CouponType[] = ['PORCENTAJE', 'FIJO'];
/** Límite de `dom_importe` (numeric 12,2). */
const MAX_AMOUNT = 9_999_999_999.99;

const asObject = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw AppError.validation('El cuerpo debe ser un objeto JSON.');
  return body as Record<string, unknown>;
};


/** Código normalizado a mayúsculas (`bienvenida10` → `BIENVENIDA10`). */
export const normalizeCode = (code: string) => code.trim().toUpperCase();

function readMaxUses(body: Record<string, unknown>, invalid: InvalidParam[]): number | null | undefined {
  if (body.max_uses === undefined) return undefined;
  if (body.max_uses === null) return null;
  if (typeof body.max_uses !== 'number' || !Number.isInteger(body.max_uses) || body.max_uses < 1 || body.max_uses > 2_147_483_647) {
    invalid.push({ name: 'max_uses', reason: 'Entero mayor o igual a 1, o null (sin límite).' });
    return undefined;
  }
  return body.max_uses;
}

function readEndDate(body: Record<string, unknown>, invalid: InvalidParam[]): string | null | undefined {
  if (body.end_date === undefined) return undefined;
  if (body.end_date === null) return null;
  if (!isDate(body.end_date)) {
    invalid.push({ name: 'end_date', reason: 'Fecha YYYY-MM-DD o null (sin fin).' });
    return undefined;
  }
  return body.end_date;
}

/** Reglas de negocio (422): porcentaje hasta 100 y fin no anterior al inicio. */
export function checkCouponRules(c: { type: CouponType; value: number; startDate: string; endDate: string | null }): void {
  const invalid: InvalidParam[] = [];
  if (c.type === 'PORCENTAJE' && c.value > 100) invalid.push({ name: 'value', reason: 'Un porcentaje no puede pasar de 100.' });
  if (c.endDate && c.endDate < c.startDate) invalid.push({ name: 'end_date', reason: 'Debe ser igual o posterior a start_date.' });
  if (invalid.length) throw AppError.unprocessable('SEMANTIC_VALIDATION_FAILED', 'El cupón no cumple las reglas de negocio.', invalid);
}

/** `CouponCreateRequest`: errores de tipo o formato → 400; reglas de negocio → 422. */
export function parseCouponCreate(value: unknown): CouponCreate {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  const code = typeof body.code === 'string' ? normalizeCode(body.code) : '';
  if (!CODE.test(code)) invalid.push({ name: 'code', reason: 'De 3 a 30 caracteres: letras, números, guion y guion bajo.' });
  if (!TYPES.includes(body.type as CouponType)) invalid.push({ name: 'type', reason: 'PORCENTAJE o FIJO.' });
  const amount = body.value;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT || !hasAtMostTwoDecimals(amount)) {
    invalid.push({ name: 'value', reason: 'Número mayor o igual a 0, con hasta dos decimales.' });
  }
  if (!isDate(body.start_date)) invalid.push({ name: 'start_date', reason: 'Fecha YYYY-MM-DD.' });
  const endDate = readEndDate(body, invalid);
  const maxUses = readMaxUses(body, invalid);
  if (body.active !== undefined && typeof body.active !== 'boolean') invalid.push({ name: 'active', reason: 'true o false.' });
  if (invalid.length) throw AppError.validation('El cupón no es válido.', invalid);
  const coupon: CouponCreate = {
    code,
    type: body.type as CouponType,
    value: amount as number,
    startDate: body.start_date as string,
    endDate: endDate ?? null,
    maxUses: maxUses ?? null,
    active: (body.active as boolean | undefined) ?? true,
  };
  checkCouponRules(coupon);
  return coupon;
}

/** `CouponUpdateRequest`: al menos un campo, y nunca `code`, `type` ni `value`. */
export function parseCouponPatch(value: unknown): CouponPatch {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  for (const fixed of ['code', 'type', 'value']) {
    if (body[fixed] !== undefined) invalid.push({ name: fixed, reason: 'No se puede cambiar; para otro descuento cree otro cupón.' });
  }
  const patch: CouponPatch = {};
  if (body.start_date !== undefined) {
    if (!isDate(body.start_date)) invalid.push({ name: 'start_date', reason: 'Fecha YYYY-MM-DD.' });
    else patch.startDate = body.start_date;
  }
  const endDate = readEndDate(body, invalid);
  if (endDate !== undefined) patch.endDate = endDate;
  const maxUses = readMaxUses(body, invalid);
  if (maxUses !== undefined) patch.maxUses = maxUses;
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') invalid.push({ name: 'active', reason: 'true o false.' });
    else patch.active = body.active;
  }
  if (!invalid.length && Object.keys(patch).length === 0) invalid.push({ name: 'body', reason: 'Envíe start_date, end_date, max_uses o active.' });
  if (invalid.length) throw AppError.validation('Los cambios del cupón no son válidos.', invalid);
  return patch;
}

/** Query de `GET /cupones`. */
export function parseCouponFilters(query: Record<string, unknown>): CouponFilters {
  const invalid: InvalidParam[] = [];
  const text = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const activeRaw = text(query.active);
  let active: boolean | null = null;
  if (activeRaw !== undefined) {
    if (activeRaw === 'true') active = true;
    else if (activeRaw === 'false') active = false;
    else invalid.push({ name: 'active', reason: 'true o false.' });
  }
  const codeRaw = text(query.code);
  const code = typeof codeRaw === 'string' && codeRaw.trim() ? codeRaw.trim().slice(0, 30) : null;
  const int = (raw: unknown, name: string, def: number, max: number) => {
    if (raw === undefined) return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      invalid.push({ name, reason: `Entero entre 1 y ${max}.` });
      return def;
    }
    return n;
  };
  const page = int(text(query.page), 'page', 1, 100_000);
  const limit = int(text(query.limit), 'limit', 10, 50);
  if (invalid.length) throw AppError.validation('Los filtros no son válidos.', invalid);
  return { active, code, page, limit };
}

/** `CouponValidationRequest`. */
export function parseValidation(value: unknown): ValidationInput {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  if (typeof body.code !== 'string' || !body.code.trim() || body.code.length > 30) invalid.push({ name: 'code', reason: 'Código del cupón.' });
  if (typeof body.subtotal !== 'number' || !Number.isFinite(body.subtotal) || body.subtotal < 0 || body.subtotal > MAX_AMOUNT) {
    invalid.push({ name: 'subtotal', reason: 'Número mayor o igual a 0.' });
  }
  if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))) invalid.push({ name: 'currency', reason: 'Código ISO de 3 letras.' });
  if (body.date !== undefined && !isDate(body.date)) invalid.push({ name: 'date', reason: 'Fecha YYYY-MM-DD.' });
  if (invalid.length) throw AppError.validation('La solicitud de validación no es válida.', invalid);
  return {
    code: normalizeCode(body.code as string),
    subtotal: body.subtotal as number,
    currency: (body.currency as string | undefined) ?? 'USD',
    date: (body.date as string | undefined) ?? null,
  };
}
