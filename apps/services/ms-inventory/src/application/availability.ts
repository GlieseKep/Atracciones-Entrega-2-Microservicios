import { BUSINESS_TIME_ZONE, timeLabel, todayIn } from '@atracciones/platform';
import type { DisponibilidadResponse, SlotStatus, TimeSlotItem } from '../contract';
import type { AvailableSlotRow } from '../persistence/availability-repository';

/** Hora actual `HH:mm:ss` en la zona del negocio. */
export function nowTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
}

export const businessNow = () => ({ today: todayIn(), now: nowTime() });

export function slotStatus(available: number): SlotStatus {
  if (available <= 0) return 'AGOTADO';
  return available <= 3 ? 'ULTIMOS_CUPOS' : 'DISPONIBLE';
}

function toItem(row: AvailableSlotRow): TimeSlotItem {
  const available = row.dis_cupo_total - row.dis_cupo_reservado;
  const status = slotStatus(available);
  const time = timeLabel(row.hora);
  return {
    slot_id: row.dis_slot_codigo,
    time,
    time_24h: row.hora,
    total_slots: row.dis_cupo_total,
    available_slots: available,
    status,
    hora: time,
    hora_24h: row.hora,
    cupos_totales: row.dis_cupo_total,
    cupos_disponibles: available,
    estado: status,
  };
}

export function toAvailability(codigo: string, date: string, rows: AvailableSlotRow[]): DisponibilidadResponse {
  const items = rows.map(toItem);
  const total = items.reduce((sum, item) => sum + item.available_slots, 0);
  return { atraccion_id: codigo, date, fecha: date, total_available_slots: total, total_cupos_disponibles: total, time_slots: items, turnos: items };
}
