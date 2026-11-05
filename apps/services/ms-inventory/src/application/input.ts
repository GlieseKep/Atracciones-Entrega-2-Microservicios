import { AppError, normalizeTime } from '@atracciones/platform';

const invalid = (name: string, reason: string) => AppError.validation(`'${name}' no es válido: ${reason}`, [{ name, reason }]);

export function parseCode(value: unknown, name = 'atraccion_id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{12}$/.test(value)) throw invalid(name, 'Debe ser el ID público de 12 caracteres.');
  return value;
}

export function parseDate(value: unknown, name: string): string {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw invalid(name, 'Debe ser una fecha YYYY-MM-DD.');
  }
  return text;
}

/** Fecha opcional: vacía es `null`. */
export const parseOptionalDate = (value: unknown, name: string) => (value ? parseDate(value, name) : null);

export function parsePositive(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw invalid(name, 'Debe ser un entero positivo.');
  return value as number;
}

export function parseKey(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 120) throw invalid('clave_idempotencia', 'Es obligatoria, de hasta 120 caracteres.');
  return value;
}

export function parseSlotCode(value: unknown): string {
  if (typeof value !== 'string' || !/^slot-[0-9]{8}-[0-9]{4}$/.test(value)) throw invalid('slot_id', 'Debe tener el formato slot-YYYYMMDD-HHMM.');
  return value;
}

export function parseTime(value: unknown): string {
  const time = typeof value === 'string' ? normalizeTime(value) : null;
  if (!time) throw invalid('hora', 'La hora no es válida.');
  return time;
}

export function parseReason(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '' || text.length > 200) throw invalid('motivo', 'Es obligatorio, de hasta 200 caracteres.');
  return text;
}

/** Guía de Catalog: ausente o `0` es `null` (sin guía, o el del horario según la operación). */
export function parseGuideId(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || Number(value) === 0) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw invalid('gui_id', 'Debe ser un entero positivo, o 0 para ninguno.');
  return id;
}

/** Días ISO (1 = lunes … 7 = domingo), sin repetir. Vacío = todos. */
export function parseWeekdays(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('dias_semana', 'Debe ser una lista.');
  const days = value.map(Number);
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw invalid('dias_semana', 'Cada día va de 1 (lunes) a 7 (domingo).');
  return [...new Set(days)].sort();
}

export function parseCodes(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalid('atraccion_ids', 'Debe ser una lista.');
  return [...new Set(value.map((code) => parseCode(code, 'atraccion_ids')))];
}
