import { AppError, type InvalidParam } from '@atracciones/platform';
import type { MensajeInput } from '../contract';

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function parseMessage(body: unknown): MensajeInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: InvalidParam[] = [];
  const text = (name: string, max: number) => {
    const value = typeof b[name] === 'string' ? (b[name] as string).trim() : '';
    if (value === '' || value.length > max) errors.push({ name, reason: `Es obligatorio, de hasta ${max} caracteres.` });
    return value;
  };
  const input = { nombre: text('nombre', 120), correo: text('correo', 160), asunto: text('asunto', 30), cuerpo: text('cuerpo', 2000) };
  if (input.correo !== '' && !EMAIL.test(input.correo)) errors.push({ name: 'correo', reason: 'El correo no es válido.' });
  if (errors.length > 0) throw AppError.validation('El mensaje tiene campos inválidos.', errors);
  return input;
}

export function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation("'id' debe ser un entero positivo.", [{ name: 'id', reason: 'Debe ser un entero positivo.' }]);
  return id;
}

export function parseRead(body: unknown): boolean {
  const leido = (body as { leido?: unknown } | undefined)?.leido;
  if (typeof leido !== 'boolean') throw AppError.validation("'leido' debe ser booleano.", [{ name: 'leido', reason: 'Debe ser booleano.' }]);
  return leido;
}

export function parseMessageQuery(query: Record<string, unknown>): { leido: boolean | null; page: number; limit: number } {
  const read = (name: string, fallback: number, max: number) => {
    if (query[name] === undefined) return fallback;
    const value = Number(query[name]);
    if (!Number.isInteger(value) || value < 1 || value > max) throw AppError.validation(`'${name}' debe ser un entero entre 1 y ${max}.`, [{ name, reason: 'Fuera de rango.' }]);
    return value;
  };
  if (query.leido !== undefined && query.leido !== 'true' && query.leido !== 'false') {
    throw AppError.validation("'leido' debe ser true o false.", [{ name: 'leido', reason: 'Debe ser booleano.' }]);
  }
  return { leido: query.leido === undefined ? null : query.leido === 'true', page: read('page', 1, Number.MAX_SAFE_INTEGER), limit: read('limit', 10, 50) };
}
