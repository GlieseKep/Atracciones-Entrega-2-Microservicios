/** Tipos del contrato `Plan/ms_inventory/inventory.proto`. */
export type SlotStatus = 'DISPONIBLE' | 'ULTIMOS_CUPOS' | 'AGOTADO';

export interface TimeSlotItem {
  slot_id: string;
  time: string;
  time_24h: string;
  total_slots: number;
  available_slots: number;
  status: SlotStatus;
  hora: string;
  hora_24h: string;
  cupos_totales: number;
  cupos_disponibles: number;
  estado: SlotStatus;
}

export interface DisponibilidadResponse {
  atraccion_id: string;
  date: string;
  fecha: string;
  total_available_slots: number;
  total_cupos_disponibles: number;
  time_slots: TimeSlotItem[];
  turnos: TimeSlotItem[];
}

export interface ReserveSeatsRequest {
  atraccion_id: string;
  slot_id: string;
  cantidad: number;
  clave_idempotencia: string;
}

export interface ReserveSeatsResponse {
  dis_id: number;
  slot_id: string;
  cupos_disponibles: number;
}

export interface ReleaseSeatsResponse {
  liberado: boolean;
  cupos_disponibles: number;
}

export interface Schedule {
  hor_id: number;
  atraccion_id: string;
  hora: string;
  cupo: number;
  activo: boolean;
}

export interface Slot {
  dis_id: number;
  atraccion_id: string;
  slot_id: string;
  fecha: string;
  hora: string;
  cupo_total: number;
  cupo_reservado: number;
  cerrada: boolean;
}

export interface BlockedDate {
  atraccion_id: string;
  fecha: string;
  motivo: string;
}

/** Tipo en `outbox` del stock hacia Booking Prototipo. No va al bus: lo entrega `BookingStockSync`. */
export const STOCK_EVENT = 'STOCK_BOOKING';

/**
 * Datos de una fila `STOCK_BOOKING`. `push` lleva el saldo (`PushStockUpdate`); `stream`, la variación
 * (`StreamInventoryChanges`), para los lotes.
 */
export interface StockPayload {
  modo: 'push' | 'stream';
  item_id: string;
  slot_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  delta: number;
  timestamp: number;
}
