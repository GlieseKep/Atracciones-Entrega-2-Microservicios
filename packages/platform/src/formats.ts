/** Formatos del contrato v2 que comparten varios componentes (plan §4.1 y §7.5). */

/** Zona horaria del negocio: las fechas y horas de los turnos son locales de Ecuador continental. */
export const BUSINESS_TIME_ZONE = 'America/Guayaquil';

/** Fecha `YYYY-MM-DD` de hoy en la zona del negocio. */
export function todayIn(timeZone = BUSINESS_TIME_ZONE, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Instante UTC de una fecha y hora locales en la zona indicada (p. ej. el inicio de un turno en Ecuador). */
export function zonedToUtc(date: string, time: string, timeZone = BUSINESS_TIME_ZONE): Date {
  const asUtc = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  // Desfase de la zona en ese instante (Ecuador continental es UTC-5 todo el año, pero se calcula igual para cualquier zona).
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(asUtc).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
  const minutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return new Date(asUtc.getTime() - minutes * 60_000);
}

/** Suma días a una fecha `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `HH:mm:ss` a partir de `HH:mm`, `HH:mm:ss` o `10:30 a.m.` / `1:05 p.m.`; `null` si no es una hora válida. */
export function normalizeTime(value: string): string | null {
  const text = value.trim().toLowerCase();
  const h24 = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text);
  if (h24) return `${h24[1]}:${h24[2]}:${h24[3] ?? '00'}`;
  const h12 = /^(\d{1,2}):([0-5]\d)\s*([ap])\.?\s*m\.?$/.exec(text);
  if (!h12) return null;
  const hour = Number(h12[1]);
  if (hour < 1 || hour > 12) return null;
  const hour24 = (hour % 12) + (h12[3] === 'p' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${h12[2]}:00`;
}

/** Etiqueta legible del contrato (`10:30 a.m.`, `09:00 a.m.`, `12:00 p.m.`) a partir de `HH:mm[:ss]`. */
export function timeLabel(time: string): string {
  const [h, m] = time.split(':');
  const hour = Number(h);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour12).padStart(2, '0')}:${m} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
}

/** Identificador del turno del contrato: `slot-YYYYMMDD-HHmm`. */
export const slotId = (date: string, time: string) => `slot-${date.replace(/-/g, '')}-${time.slice(0, 5).replace(':', '')}`;

/** Separa un `slot_id` en fecha (`YYYY-MM-DD`) y hora (`HH:mm:00`); `null` si no tiene el formato del contrato. */
export function parseSlotId(value: string): { date: string; time: string } | null {
  const match = /^slot-(\d{4})(\d{2})(\d{2})-([01]\d|2[0-3])([0-5]\d)$/.exec(value);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  return { date, time: `${match[4]}:${match[5]}:00` };
}

/** `"7 horas"`, `"1 hora"`, `"1.5 horas"`. */
export const durationLabel = (hours: number) => `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? 'hora' : 'horas'}`;

/** Redondeo monetario a 2 decimales. */
export const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
