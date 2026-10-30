import { parseSlotId, todayIn } from '@atracciones/platform';

/** Fecha (`YYYY-MM-DD`) y hora (`HH:mm:ss`) de un turno. */
export interface SlotTime {
  date: string;
  time: string;
}

/** Fecha y hora del turno a partir de su `slot_id` (`slot-YYYYMMDD-HHmm`); `null` sin turno o con un formato inválido. */
export const slotTime = (slot: string | null | undefined): SlotTime | null => (slot ? parseSlotId(slot) : null);

/** Fecha y hora actuales en la zona del negocio. */
export function businessNow(timeZone: string, now = new Date()): SlotTime {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
  return { date: todayIn(timeZone, now), time };
}

/** Un turno que ya empezó (o es de un día pasado) no se puede agregar al carrito. */
export function isPast(slot: SlotTime, timeZone: string, now = new Date()): boolean {
  const current = businessNow(timeZone, now);
  return slot.date < current.date || (slot.date === current.date && slot.time <= current.time);
}
