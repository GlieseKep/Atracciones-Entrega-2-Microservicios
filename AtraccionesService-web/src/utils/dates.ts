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
