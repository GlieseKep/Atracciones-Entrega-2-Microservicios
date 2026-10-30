import { AppError, type InvalidParam } from '@atracciones/platform';
import type { ResenaInput } from '../contract';

type Body = Record<string, unknown>;

const asBody = (body: unknown): Body => (body && typeof body === 'object' ? (body as Body) : {});

function readReview(b: Body, errors: InvalidParam[]): ResenaInput {
  const score = (name: keyof ResenaInput) => {
    const value = b[name];
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10) errors.push({ name, reason: 'Debe ser un entero de 1 a 10.' });
    return value as number;
  };
  const comentario = typeof b.comentario === 'string' ? b.comentario.trim() : '';
  if (comentario === '' || comentario.length > 1000) errors.push({ name: 'comentario', reason: 'Es obligatorio, de hasta 1000 caracteres.' });
  return {
    puntuacion: score('puntuacion'),
    limpieza: score('limpieza'),
    servicio: score('servicio'),
    calidad_precio: score('calidad_precio'),
    puntualidad: score('puntualidad'),
    comentario,
  };
}

const done = (errors: InvalidParam[]) => {
  if (errors.length > 0) throw AppError.validation('La reseña tiene campos inválidos.', errors);
};

export function parseReview(body: unknown): ResenaInput {
  const errors: InvalidParam[] = [];
  const input = readReview(asBody(body), errors);
  done(errors);
  return input;
}

export function parseAnonymousReview(body: unknown): { autorNombre: string; review: ResenaInput } {
  const b = asBody(body);
  const errors: InvalidParam[] = [];
  const review = readReview(b, errors);
  const autorNombre = typeof b.autor_nombre === 'string' ? b.autor_nombre.trim() : '';
  if (autorNombre === '' || autorNombre.length > 120) errors.push({ name: 'autor_nombre', reason: 'Es obligatorio, de hasta 120 caracteres.' });
  done(errors);
  return { autorNombre, review };
}

export function parseId(value: unknown, name = 'id'): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation(`'${name}' debe ser un entero positivo.`, [{ name, reason: 'Debe ser un entero positivo.' }]);
  return id;
}

export function parsePaging(query: Record<string, unknown>): { page: number; limit: number } {
  const read = (name: string, fallback: number, max: number) => {
    if (query[name] === undefined) return fallback;
    const value = Number(query[name]);
    if (!Number.isInteger(value) || value < 1 || value > max) throw AppError.validation(`'${name}' debe ser un entero entre 1 y ${max}.`, [{ name, reason: 'Fuera de rango.' }]);
    return value;
  };
  return { page: read('page', 1, Number.MAX_SAFE_INTEGER), limit: read('limit', 10, 50) };
}

export function parseVisibleFilter(value: unknown): boolean | null {
  if (value === undefined) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw AppError.validation("'visible' debe ser true o false.", [{ name: 'visible', reason: 'Debe ser booleano.' }]);
}

export function parseVisible(body: unknown): boolean {
  const visible = asBody(body).visible;
  if (typeof visible !== 'boolean') throw AppError.validation("'visible' debe ser booleano.", [{ name: 'visible', reason: 'Debe ser booleano.' }]);
  return visible;
}
