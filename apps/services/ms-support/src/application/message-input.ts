import { AppError, paging, type InvalidParam, type Paging } from '@atracciones/platform';
import { ESTADOS_MENSAJE, type MessageStatus } from '../contract';

export interface MessageInput {
  nombre: string;
  correo: string;
  asunto: string;
  cuerpo: string;
}

export interface MessageFilters extends Paging {
  estado: MessageStatus | null;
  search: string | null;
}

/** Mismo patrón que el dominio `dom_correo`: lo que pasa aquí no lo rechaza la base. */
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const asObject = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw AppError.validation('El cuerpo debe ser un objeto JSON.');
  return body as Record<string, unknown>;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Primer valor de un parámetro de query (`?a=1&a=2` → `'1'`). */
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const isStatus = (value: unknown): value is MessageStatus => ESTADOS_MENSAJE.includes(value as MessageStatus);

/** `ContactMessageRequest`, con las mismas reglas que tenía Audit (el nombre ahora llega hasta 120). */
export function parseMessage(value: unknown): MessageInput {
  const body = asObject(value);
  const data = { nombre: text(body.nombre), correo: text(body.email).toLowerCase(), asunto: text(body.asunto), cuerpo: text(body.mensaje) };
  const invalid: InvalidParam[] = [];
  if (data.nombre.length < 2 || data.nombre.length > 120) invalid.push({ name: 'nombre', reason: 'Debe tener entre 2 y 120 caracteres.' });
  if (data.correo.length > 160 || !EMAIL.test(data.correo)) invalid.push({ name: 'email', reason: 'Debe ser un correo electrónico válido.' });
  if (data.asunto.length < 3 || data.asunto.length > 200) invalid.push({ name: 'asunto', reason: 'Debe tener entre 3 y 200 caracteres.' });
  if (data.cuerpo.length < 10 || data.cuerpo.length > 4000) invalid.push({ name: 'mensaje', reason: 'Debe tener entre 10 y 4000 caracteres.' });
  if (invalid.length) throw AppError.validation('El mensaje de contacto no es válido.', invalid);
  return data;
}

/** Cuerpo de `PUT /mensajes-contacto/{id}/estado`. */
export function parseStatus(value: unknown): MessageStatus {
  const estado = asObject(value).estado;
  if (!isStatus(estado)) throw AppError.validation('Estado inválido.', [{ name: 'estado', reason: `Debe ser uno de ${ESTADOS_MENSAJE.join(', ')}.` }]);
  return estado;
}

/** ID de mensaje de la ruta; `null` si no es un número válido (la ruta responde 404, no 400). */
export function parseMessageId(raw: string): number | null {
  const id = Number(raw);
  return /^[0-9]+$/.test(raw) && Number.isSafeInteger(id) && id >= 1 ? id : null;
}

/** Query de `GET /mensajes-contacto`. */
export function parseMessageFilters(query: Record<string, unknown>): MessageFilters {
  const invalid: InvalidParam[] = [];
  const estadoRaw = first(query.estado);
  let estado: MessageStatus | null = null;
  if (estadoRaw !== undefined && estadoRaw !== '') {
    if (!isStatus(estadoRaw)) invalid.push({ name: 'estado', reason: `Uno de ${ESTADOS_MENSAJE.join(', ')}.` });
    else estado = estadoRaw;
  }
  const searchRaw = first(query.search);
  let search: string | null = null;
  if (searchRaw !== undefined) {
    if (typeof searchRaw !== 'string' || searchRaw.length > 100) invalid.push({ name: 'search', reason: 'Texto de hasta 100 caracteres.' });
    else search = searchRaw.trim() || null;
  }
  if (invalid.length) throw AppError.validation('Los filtros no son válidos.', invalid);
  return { estado, search, ...paging({ limit: first(query.limit), offset: first(query.offset) }, 20, 100) };
}
