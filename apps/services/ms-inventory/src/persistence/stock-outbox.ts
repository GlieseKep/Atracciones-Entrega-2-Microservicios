import { recordEvent, recordEvents, timeLabel } from '@atracciones/platform';
import type { EntityManager } from 'typeorm';
import { STOCK_EVENT, type StockPayload } from '../contract';

export interface SlotStock {
  atr_codigo: string;
  dis_slot_codigo: string;
  dis_fecha: string;
  hora: string;
  disponibles: number;
}

const stockPayload = (slot: SlotStock, modo: StockPayload['modo'], delta: number): StockPayload => ({
  modo,
  item_id: slot.atr_codigo,
  slot_id: slot.dis_slot_codigo,
  date: slot.dis_fecha,
  time_slot: timeLabel(slot.hora),
  available_units: slot.disponibles,
  delta,
  timestamp: Date.now(),
});

/** Deja en el outbox, en la transacción del cambio, el stock para Booking Prototipo. */
export function recordStock(m: EntityManager, slot: SlotStock, modo: StockPayload['modo'], delta = 0): Promise<string> {
  return recordEvent(m, { tipoEvento: STOCK_EVENT, agregadoId: slot.atr_codigo, payload: { ...stockPayload(slot, modo, delta) } });
}

/** Varios turnos nuevos en una sola consulta: el delta de cada uno es su cupo total. */
export function recordNewSlotsStock(m: EntityManager, slots: (SlotStock & { dis_cupo_total: number })[]): Promise<string[]> {
  return recordEvents(m, slots.map((slot) => ({ tipoEvento: STOCK_EVENT, agregadoId: slot.atr_codigo, payload: { ...stockPayload(slot, 'stream', slot.dis_cupo_total) } })));
}
