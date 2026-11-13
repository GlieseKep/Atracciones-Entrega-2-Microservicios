import type { TimeSlot } from '@/types/attraction';

/** Un turno con 0 cupos es AGOTADO aunque el backend todavía no lo marque. */
export const isSoldOut = (slot: TimeSlot) => slot.status === 'AGOTADO' || slot.available_slots <= 0;

/** El turno ya no admite la compra: agotado o con menos cupos que boletos. */
export const slotUnavailable = (slot: TimeSlot, quantity: number) => isSoldOut(slot) || slot.available_slots < quantity;
