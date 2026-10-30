const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha real con formato `YYYY-MM-DD` (rechaza `2026-02-30`). */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const addYears = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
