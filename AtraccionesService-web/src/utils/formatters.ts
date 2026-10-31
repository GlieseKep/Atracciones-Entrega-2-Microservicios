import type { Price } from '@/types/api';

const LOCALE = 'es-EC';

/** `US$ 9,50` — mismo formato corto que usa Viator para precios "desde". */
export function formatMoney(amount: number, currency = 'USD'): string {
  const formatted = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: currency === 'USD' ? 'code' : 'symbol',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === 'USD' ? formatted.replace('USD', 'US$').replace(/\s+/, ' ').trim() : formatted;
}

export const formatPrice = (price: Price) => formatMoney(price.total, price.currency);

/** Convierte una duración ISO 8601 (`PT2H30M`, `P1D`) a minutos. Devuelve `null` si no es válida. */
export function durationToMinutes(iso: string): number | null {
  const match = /^P(?!$)(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso);
  if (!match) return null;
  const [, d = '0', h = '0', m = '0'] = match;
  return Number(d) * 24 * 60 + Number(h) * 60 + Number(m);
}

/** `PT2H30M` → `2 h 30 min`; `P1D` → `1 día`. */
export function formatDuration(iso: string): string {
  const total = durationToMinutes(iso);
  if (total === null) return iso;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'día' : 'días'}`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  return parts.join(' ') || '0 min';
}

export function formatReviewCount(count: number): string {
  return new Intl.NumberFormat(LOCALE).format(count);
}

export function formatScore(score: number): string {
  return score.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export const PRODUCT_TYPE_LABEL = {
  SINGLE_TICKET: 'Entrada',
  GUIDED_TOUR: 'Tour guiado',
  PACKAGE: 'Excursión de día completo',
} as const;

export const LANGUAGE_LABEL: Record<string, string> = { es: 'Español', en: 'Inglés', fr: 'Francés', de: 'Alemán' };

export const formatLanguage = (code: string) => LANGUAGE_LABEL[code] ?? code.toUpperCase();

/** Abrevia un identificador para mostrarlo como código de seguimiento. */
export const shortCode = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();
