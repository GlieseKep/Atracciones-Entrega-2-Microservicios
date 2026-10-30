import { AppError, type InvalidParam } from '@atracciones/platform';

export type Body = Record<string, unknown>;

export const asBody = (value: unknown): Body => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Body) : {});

/** Lee un cuerpo acumulando los errores, para responderlos juntos en `invalid_params`. */
export class Fields {
  readonly errors: InvalidParam[] = [];
  readonly body: Body;

  constructor(body: unknown, private readonly prefix = '') {
    this.body = asBody(body);
  }

  fail(name: string, reason: string): void {
    this.errors.push({ name: `${this.prefix}${name}`, reason });
  }

  has(name: string): boolean {
    return this.body[name] !== undefined;
  }

  text(name: string, max: number): string {
    const value = this.body[name];
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '' || text.length > max) this.fail(name, `Es obligatorio, de hasta ${max} caracteres.`);
    return text;
  }

  /** Texto opcional; vacío o ausente es `null`. */
  optionalText(name: string, max: number, pattern?: RegExp): string | null {
    const value = this.body[name];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      this.fail(name, 'Debe ser texto.');
      return null;
    }
    const text = value.trim();
    if (text === '') return null;
    if (text.length > max || (pattern && !pattern.test(text))) this.fail(name, 'El formato no es válido.');
    return text;
  }

  bool(name: string, fallback = false): boolean {
    const value = this.body[name];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') {
      this.fail(name, 'Debe ser booleano.');
      return fallback;
    }
    return value;
  }

  number(name: string, range: { min?: number; max?: number } = {}): number {
    const value = this.body[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || (range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) {
      this.fail(name, 'Número fuera de rango.');
      return 0;
    }
    return value;
  }

  integer(name: string, range: { min?: number; max?: number } = {}, fallback?: number): number {
    if (this.body[name] === undefined && fallback !== undefined) return fallback;
    const value = this.number(name, range);
    if (!Number.isInteger(value)) this.fail(name, 'Debe ser un entero.');
    return value;
  }

  /** Entero opcional; ausente es `null`. */
  optionalInteger(name: string, range: { min?: number; max?: number } = {}): number | null {
    const value = this.body[name];
    return value === undefined || value === null ? null : this.integer(name, range);
  }

  oneOf<T extends string>(name: string, values: readonly T[]): T {
    const value = this.body[name];
    if (!values.includes(value as T)) this.fail(name, `Debe ser ${values.join(', ')}.`);
    return value as T;
  }

  stringList(name: string, required = false): string[] {
    const value = this.body[name];
    if (value === undefined && !required) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string') || (required && value.length === 0)) {
      this.fail(name, 'Debe ser una lista de texto.');
      return [];
    }
    return [...new Set(value as string[])];
  }

  done(): void {
    if (this.errors.length > 0) throw AppError.validation('La solicitud tiene campos inválidos.', this.errors);
  }
}

/** Filtros de una query: `true` o `false`. */
export function queryBoolean(value: unknown, name: string): boolean | null {
  if (value === undefined) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw AppError.validation(`'${name}' debe ser true o false.`, [{ name, reason: 'Debe ser booleano.' }]);
}

export function queryInteger(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw AppError.validation(`'${name}' debe ser un entero entre 1 y ${max}.`, [{ name, reason: 'Fuera de rango.' }]);
  return number;
}

export function pathId(value: unknown, name: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation(`'${name}' debe ser un entero positivo.`, [{ name, reason: 'Debe ser un entero positivo.' }]);
  return id;
}

export const queryText = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
