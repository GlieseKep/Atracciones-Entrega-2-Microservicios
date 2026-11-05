import type { TicketPrices } from '@/types/attraction';
import type { TicketCounts, TicketType } from '@/types/booking';

const LOCALE = 'es-EC';

/** `US$ 9,50` — formato corto para precios "desde". */
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

/** Precio "desde": la tarifa de adulto. */
export const formatFromPrice = (price: TicketPrices) => formatMoney(price.adult, price.currency);

export const TICKET_TYPES: { type: TicketType; label: string; help: string }[] = [
  { type: 'adult', label: 'Adultos', help: '13 a 64 años' },
  { type: 'child', label: 'Niños', help: '5 a 12 años' },
  { type: 'senior', label: 'Adultos mayores', help: '65 años o más' },
  { type: 'infant', label: 'Infantes', help: '0 a 4 años, ocupan cupo' },
];

export const ticketTotal = (counts: TicketCounts) => counts.adult + counts.child + counts.senior + counts.infant;

/** Importe estimado con la tarifa del catálogo; Booking calcula el total final. */
export const estimateTotal = (price: TicketPrices, counts: TicketCounts) =>
  Math.round((price.adult * counts.adult + price.child * counts.child + price.senior * counts.senior + price.infant * counts.infant) * 100) / 100;

/** `2 adultos, 1 niño` */
export function describeTickets(counts: Partial<TicketCounts>): string {
  const names: Record<TicketType, [string, string]> = {
    adult: ['adulto', 'adultos'],
    child: ['niño', 'niños'],
    senior: ['adulto mayor', 'adultos mayores'],
    infant: ['infante', 'infantes'],
  };
  return (Object.keys(names) as TicketType[])
    .filter((t) => (counts[t] ?? 0) > 0)
    .map((t) => `${counts[t]} ${names[t][counts[t] === 1 ? 0 : 1]}`)
    .join(', ');
}

export function formatReviewCount(count: number): string {
  return new Intl.NumberFormat(LOCALE).format(count);
}

export function formatScore(score: number): string {
  return score.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Las reseñas puntúan de 1 a 10; las estrellas de la interfaz, de 0 a 5. */
export const toStars = (score10: number) => Math.round((score10 / 2) * 10) / 10;

/** `Tour Quito (ADULT)` → `Tour Quito`: las líneas de la orden llevan el tipo de boleto en el nombre. */
export const lineAttractionName = (descripcion: string) => descripcion.replace(/\s*\((ADULT|CHILD|SENIOR|INFANT|STUDENT)\)$/, '');
