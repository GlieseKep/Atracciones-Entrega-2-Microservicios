import type { IsoDate, IsoDateTime } from '@/types/api';

const LOCALE = 'es-EC';

/** Fecha local `YYYY-MM-DD` sin desplazamientos de zona horaria. */
export function toIsoDate(date: Date): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Interpreta `YYYY-MM-DD` como fecha local (no UTC). */
export function parseIsoDate(value: IsoDate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toIsoDate(parseIsoDate(value)) === value;
};

export const isValidLocalTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export const today = (): IsoDate => toIsoDate(new Date());

/** Fecha de negocio (Ecuador), la que usa Booking para el check-in; no depende de la zona horaria del navegador. */
export const todayInEcuador = (): IsoDate =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** El check-in se hace antes del turno o el mismo día; después de la fecha del turno, no. */
export const canCheckIn = (value: IsoDate) => value >= todayInEcuador();

/**
 * Inicio del turno: fecha `YYYY-MM-DD` y hora (`10:30 a.m.` como la devuelve Booking, o `HH:mm`) en Ecuador, que es UTC-5
 * todo el año. `null` si la hora no se entiende.
 */
export function slotStart(date: IsoDate, time: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?$/i.exec(time.trim());
  if (!match) return null;
  let hour = Number(match[1]) % (match[3] ? 12 : 24);
  if (match[3]?.toLowerCase() === 'p') hour += 12;
  const start = new Date(`${date}T${String(hour).padStart(2, '0')}:${match[2]}:00-05:00`);
  return Number.isNaN(start.getTime()) ? null : start;
}

/** Cancelación con reembolso del 100 %: hasta 24 horas antes del inicio del turno (la regla la impone Booking). */
export const CANCELLATION_DEADLINE_HOURS = 24;
export function withinCancellationWindow(date: IsoDate, time: string, now = new Date()): boolean {
  const start = slotStart(date, time);
  return !!start && start.getTime() - now.getTime() >= CANCELLATION_DEADLINE_HOURS * 3_600_000;
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** La fecha es hoy o posterior. */
export const isNotPast = (value: IsoDate) => isValidIsoDate(value) && value >= today();

/** `sáb, 12 oct 2026` */
export function formatDate(value: IsoDate, options: Intl.DateTimeFormatOptions = {}): string {
  return parseIsoDate(value).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}

export function formatDateTime(value: IsoDateTime): string {
  return new Date(value).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
}
