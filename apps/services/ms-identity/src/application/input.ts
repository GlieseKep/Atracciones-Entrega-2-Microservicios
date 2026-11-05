import { AppError, isValidCedula, isValidFullName, isValidPassport, type InvalidParam } from '@atracciones/platform';
import { ROLES, type ClienteFiltros, type ClienteRequest, type PerfilUpdateRequest, type RegistroRequest, type RolNombre } from '../contract';
import type { UsuarioFiltros } from '../persistence/user-repository';

type Body = Record<string, unknown>;

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DOCUMENT = /^([0-9]{10}|[A-Z]{1,2}[0-9]{6,9})$/;
const PHONE = /^\+?[0-9]{7,15}$/;

/** Acumula los errores de un cuerpo para responderlos juntos en `invalid_params`. */
class Fields {
  readonly errors: InvalidParam[] = [];

  constructor(readonly body: Body) {}

  fail(name: string, reason: string): void {
    this.errors.push({ name, reason });
  }

  requiredText(name: string, max: number): string {
    const value = this.body[name];
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '' || text.length > max) this.fail(name, `Es obligatorio, de hasta ${max} caracteres.`);
    return text;
  }

  /** `undefined` si no se envió y `null` si se envió vacío. */
  optionalText(name: string, max: number, pattern?: RegExp): string | null | undefined {
    const value = this.body[name];
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') {
      this.fail(name, 'Debe ser texto.');
      return undefined;
    }
    const text = value.trim();
    if (text === '') return null;
    if (text.length > max || (pattern && !pattern.test(text))) this.fail(name, 'El formato no es válido.');
    return text;
  }

  email(name: string): string {
    const text = this.requiredText(name, 160).toLowerCase();
    if (text !== '' && !EMAIL.test(text)) this.fail(name, 'El correo no es válido.');
    return text;
  }

  password(name: string): string {
    const value = this.body[name];
    const text = typeof value === 'string' ? value : '';
    // bcrypt solo considera los primeros 72 bytes.
    if (text.length < 8 || Buffer.byteLength(text) > 72) this.fail(name, 'Debe tener entre 8 y 72 caracteres.');
    return text;
  }

  date(name: string): string | null | undefined {
    const text = this.optionalText(name, 10, /^\d{4}-\d{2}-\d{2}$/);
    if (!text) return text;
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) this.fail(name, 'La fecha no existe.');
    else if (parsed.getTime() > Date.now()) this.fail(name, 'La fecha no puede ser futura.');
    return text;
  }

  done(): void {
    if (this.errors.length > 0) throw AppError.validation('La solicitud tiene campos inválidos.', this.errors);
  }
}

const fields = (body: unknown) => new Fields(body && typeof body === 'object' && !Array.isArray(body) ? (body as Body) : {});

export function parseRegistro(body: unknown): RegistroRequest {
  const f = fields(body);
  const input: RegistroRequest = {
    correo: f.email('correo'),
    password: f.password('password'),
    nombre: f.requiredText('nombre', 120),
    apellido: f.requiredText('apellido', 120),
    documento: f.optionalText('documento', 20, DOCUMENT) ?? null,
    telefono: f.optionalText('telefono', 20, PHONE) ?? null,
    fecha_nacimiento: f.date('fecha_nacimiento') ?? null,
  };
  f.done();
  return input;
}

export function parseLogin(body: unknown): { correo: string; password: string } {
  const f = fields(body);
  const correo = f.email('correo');
  const password = f.body.password;
  if (typeof password !== 'string' || password === '') f.fail('password', 'Es obligatoria.');
  f.done();
  return { correo, password: password as string };
}

export function parseCorreo(body: unknown): string {
  const f = fields(body);
  const correo = f.email('correo');
  f.done();
  return correo;
}

/** Campo de texto obligatorio sin formato propio (`token`, `refresh_token`, `api_key`). */
export function parseSecret(body: unknown, name: string): string {
  const value = fields(body).body[name];
  if (typeof value !== 'string' || value === '') throw AppError.validation(`'${name}' es obligatorio.`, [{ name, reason: 'Es obligatorio.' }]);
  return value;
}

export function parseRecoveryConfirm(body: unknown): { token: string; password: string } {
  const f = fields(body);
  const password = f.password('password');
  f.done();
  return { token: parseSecret(body, 'token'), password };
}

export function parsePasswordChange(body: unknown): { actual: string; nuevo: string } {
  const f = fields(body);
  const nuevo = f.password('password_nuevo');
  f.done();
  return { actual: parseSecret(body, 'password_actual'), nuevo };
}

export function parseProfilePatch(body: unknown): PerfilUpdateRequest {
  const f = fields(body);
  const patch: PerfilUpdateRequest = {
    ...(f.body.nombre !== undefined ? { nombre: f.requiredText('nombre', 120) } : {}),
    ...(f.body.apellido !== undefined ? { apellido: f.requiredText('apellido', 120) } : {}),
    documento: f.optionalText('documento', 20, DOCUMENT),
    telefono: f.optionalText('telefono', 20, PHONE),
    fecha_nacimiento: f.date('fecha_nacimiento'),
    avatar: f.optionalText('avatar', 255),
  };
  f.done();
  return patch;
}

export function parseId(value: unknown, name = 'id'): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation(`'${name}' debe ser un entero positivo.`, [{ name, reason: 'Debe ser un entero positivo.' }]);
  return id;
}

export function parseActivo(body: unknown): boolean {
  const activo = fields(body).body.activo;
  if (typeof activo !== 'boolean') throw AppError.validation("'activo' debe ser booleano.", [{ name: 'activo', reason: 'Debe ser booleano.' }]);
  return activo;
}

export function parseRol(value: unknown): RolNombre {
  if (!ROLES.includes(value as RolNombre)) throw AppError.validation(`El rol debe ser ${ROLES.join(', ')}.`, [{ name: 'rol', reason: 'Rol desconocido.' }]);
  return value as RolNombre;
}

export function parseClienteApi(body: unknown): { codigo: string; nombre: string } {
  const f = fields(body);
  const input = { codigo: f.requiredText('codigo', 60), nombre: f.requiredText('nombre', 150) };
  f.done();
  return input;
}

export function parseIds(body: unknown): number[] {
  const ids = fields(body).body.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200) {
    throw AppError.validation("'ids' debe tener entre 1 y 200 elementos.", [{ name: 'ids', reason: 'Debe tener entre 1 y 200 elementos.' }]);
  }
  return [...new Set(ids.map((id) => parseId(id, 'ids')))];
}

function positiveInt(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw AppError.validation(`'${name}' debe ser un entero entre 1 y ${max}.`, [{ name, reason: 'Fuera de rango.' }]);
  return number;
}

export function parseUserFilters(query: Record<string, unknown>): UsuarioFiltros {
  if (query.activo !== undefined && query.activo !== 'true' && query.activo !== 'false') {
    throw AppError.validation("'activo' debe ser true o false.", [{ name: 'activo', reason: 'Debe ser booleano.' }]);
  }
  return {
    q: typeof query.q === 'string' && query.q.trim() !== '' ? query.q.trim() : null,
    rol: query.rol === undefined ? null : parseRol(query.rol),
    activo: query.activo === undefined ? null : query.activo === 'true',
    page: positiveInt(query.page, 'page', 1, Number.MAX_SAFE_INTEGER),
    limit: positiveInt(query.limit, 'limit', 20, 100),
  };
}

/** Cédula ecuatoriana válida (10 dígitos) o pasaporte de 6 a 9 caracteres; el RUC no identifica a una persona (422). */
function identificacion(value: unknown, name: string, problems: InvalidParam[]): string {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (/^\d{13}$/.test(text)) {
    throw AppError.unprocessable('INVALID_IDENTIFICATION', 'El RUC no identifica a una persona: envíe la cédula o el pasaporte.', [
      { name, reason: 'Debe ser una cédula o un pasaporte.' },
    ]);
  }
  const valid = /^\d{10}$/.test(text) ? isValidCedula(text) : isValidPassport(text);
  if (!valid) problems.push({ name, reason: 'Debe ser una cédula ecuatoriana válida o un pasaporte de 6 a 9 caracteres alfanuméricos.' });
  return text;
}

/** Cuerpo de `POST /clientes`: `{ nombre, email, identificacion, telefono }`. */
export function parseCliente(body: unknown): ClienteRequest {
  const f = fields(body);
  const nombre = f.requiredText('nombre', 150).replace(/\s+/g, ' ');
  if (nombre !== '' && !isValidFullName(nombre)) f.fail('nombre', 'Debe tener al menos dos palabras (nombre y apellido).');
  const email = f.email('email');
  const doc = identificacion(f.body.identificacion, 'identificacion', f.errors);
  const telefono = f.optionalText('telefono', 20)?.replace(/[\s-]/g, '') ?? null;
  if (telefono !== null && !PHONE.test(telefono)) f.fail('telefono', 'El formato debe ser +593991234567 o 0991234567.');
  f.done();
  return { nombre, email, identificacion: doc, telefono };
}

/** Query de `GET /clientes`: al menos `email` o `identificacion`. */
export function parseClienteFiltros(query: Record<string, unknown>): ClienteFiltros {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
  const email = text(query.email)?.toLowerCase() ?? null;
  const ident = text(query.identificacion)?.toUpperCase() ?? null;
  if (!email && !ident) {
    throw AppError.validation("Envíe 'email' o 'identificacion'.", [
      { name: 'email', reason: 'Se necesita email o identificacion.' },
      { name: 'identificacion', reason: 'Se necesita email o identificacion.' },
    ]);
  }
  return { email, identificacion: ident };
}
