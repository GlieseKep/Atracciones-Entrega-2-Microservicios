import type { TimeSlot } from '@/types/attraction';
import type { TicketCounts } from '@/types/booking';
import { isNotPast } from '@/utils/dates';

/** Selección que viaja del detalle a la compra en la URL: `?fecha=&turno=&hora=&adultos=&ninos=&mayores=&infantes=`. */
export interface CheckoutSelection {
  date: string;
  slotId: string;
  /** Hora del turno tal como la devuelve la disponibilidad (`10:30 a.m.` o `10:30:00`). */
  time: string;
  tickets: TicketCounts;
}

const KEYS = { adult: 'adultos', child: 'ninos', senior: 'mayores', infant: 'infantes' } as const;

const count = (value: string | null, min: number) => Math.min(20, Math.max(min, Math.floor(Number(value)) || min));

export function toCheckoutQuery(s: CheckoutSelection): URLSearchParams {
  const params = new URLSearchParams();
  if (s.date) params.set('fecha', s.date);
  if (s.slotId) params.set('turno', s.slotId);
  if (s.time) params.set('hora', s.time);
  for (const [type, key] of Object.entries(KEYS)) {
    const n = s.tickets[type as keyof TicketCounts];
    if (n > 0) params.set(key, String(n));
  }
  return params;
}

export function parseCheckoutQuery(params: URLSearchParams): CheckoutSelection {
  const date = params.get('fecha') ?? '';
  const valid = isNotPast(date);
  return {
    date: valid ? date : '',
    slotId: valid ? (params.get('turno') ?? '') : '',
    time: valid ? (params.get('hora') ?? '') : '',
    tickets: {
      adult: count(params.get(KEYS.adult), 1),
      child: count(params.get(KEYS.child), 0),
      senior: count(params.get(KEYS.senior), 0),
      infant: count(params.get(KEYS.infant), 0),
    },
  };
}

/** Hora para el contrato: la normalizada de 24 horas si el turno la trae. */
export const slotTime = (slot: Pick<TimeSlot, 'time' | 'time_24h'>) => slot.time_24h || slot.time;
