import { AppError, addDays, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { BlockedDate, Schedule, Slot } from '../contract';
import { recordNewSlotsStock, recordStock, type SlotStock } from './stock-outbox';

const SCHEDULE_COLUMNS = `hor_id, atr_codigo, hor_hora::text AS hor_hora, hor_cupo, hor_activo`;

interface ScheduleRow {
  hor_id: string;
  atr_codigo: string;
  hor_hora: string;
  hor_cupo: number;
  hor_activo: boolean;
}

const toSchedule = (row: ScheduleRow): Schedule => ({
  hor_id: Number(row.hor_id),
  atraccion_id: row.atr_codigo,
  hora: row.hor_hora,
  cupo: row.hor_cupo,
  activo: row.hor_activo,
});

const SLOT_SELECT = `SELECT d.dis_id, d.atr_codigo, d.dis_slot_codigo, d.dis_fecha::text AS dis_fecha, h.hor_hora::text AS hora,
    d.dis_cupo_total, d.dis_cupo_reservado, d.dis_cerrada
  FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id`;

interface SlotRow {
  dis_id: string;
  atr_codigo: string;
  dis_slot_codigo: string;
  dis_fecha: string;
  hora: string;
  dis_cupo_total: number;
  dis_cupo_reservado: number;
  dis_cerrada: boolean;
}

const toSlot = (row: SlotRow): Slot => ({
  dis_id: Number(row.dis_id),
  atraccion_id: row.atr_codigo,
  slot_id: row.dis_slot_codigo,
  fecha: row.dis_fecha,
  hora: row.hora,
  cupo_total: row.dis_cupo_total,
  cupo_reservado: row.dis_cupo_reservado,
  cerrada: row.dis_cerrada,
});

/** Un turno cerrado no tiene cupos a la venta. */
const toStock = (row: SlotRow): SlotStock => ({
  atr_codigo: row.atr_codigo,
  dis_slot_codigo: row.dis_slot_codigo,
  dis_fecha: row.dis_fecha,
  hora: row.hora,
  disponibles: row.dis_cerrada ? 0 : row.dis_cupo_total - row.dis_cupo_reservado,
});

const slotNotFound = (slotCode: string) => AppError.notFound(`No existe el turno ${slotCode}.`, 'SLOT_NOT_FOUND');
const scheduleNotFound = (id: number) => AppError.notFound(`No existe el horario ${id}.`, 'SCHEDULE_NOT_FOUND');

export class ScheduleRepository {
  constructor(private readonly db: DataSource) {}

  // Horarios -------------------------------------------------------------------

  async listSchedules(codigo: string): Promise<Schedule[]> {
    const rows: ScheduleRow[] = await this.db.query(`SELECT ${SCHEDULE_COLUMNS} FROM horario WHERE atr_codigo = $1 ORDER BY hor_hora`, [codigo]);
    return rows.map(toSchedule);
  }

  /** Horas de los horarios activos de cada atracción. */
  async activeTimes(codigos: string[]): Promise<{ atraccion_id: string; horas: string[] }[]> {
    if (codigos.length === 0) return [];
    const rows: { atr_codigo: string; horas: string[] }[] = await this.db.query(
      `SELECT atr_codigo, array_agg(hor_hora::text ORDER BY hor_hora) AS horas FROM horario WHERE atr_codigo = ANY($1::varchar[]) AND hor_activo GROUP BY atr_codigo`,
      [codigos],
    );
    return rows.map((row) => ({ atraccion_id: row.atr_codigo.trim(), horas: row.horas }));
  }

  async findSchedule(id: number): Promise<Schedule> {
    const [row] = await this.db.query(`SELECT ${SCHEDULE_COLUMNS} FROM horario WHERE hor_id = $1`, [id]);
    if (!row) throw scheduleNotFound(id);
    return toSchedule(row);
  }

  async createSchedule(codigo: string, hora: string, cupo: number): Promise<Schedule> {
    try {
      const [row] = await this.db.query(`INSERT INTO horario (atr_codigo, hor_hora, hor_cupo) VALUES ($1, $2, $3) RETURNING ${SCHEDULE_COLUMNS}`, [codigo, hora, cupo]);
      return toSchedule(row);
    } catch (error) {
      const driver = (error as { driverError?: { code?: string } }).driverError;
      throw driver?.code === '23505' ? AppError.conflict('SCHEDULE_EXISTS', `La atracción ya tiene un horario a las ${hora}.`) : error;
    }
  }

  async updateScheduleCapacity(id: number, cupo: number): Promise<Schedule> {
    const rows = returnedRows<ScheduleRow>(await this.db.query(`UPDATE horario SET hor_cupo = $2 WHERE hor_id = $1 RETURNING ${SCHEDULE_COLUMNS}`, [id, cupo]));
    if (rows.length === 0) throw scheduleNotFound(id);
    return toSchedule(rows[0]);
  }

  async setScheduleActive(id: number, activo: boolean): Promise<Schedule> {
    const rows = returnedRows<ScheduleRow>(await this.db.query(`UPDATE horario SET hor_activo = $2 WHERE hor_id = $1 RETURNING ${SCHEDULE_COLUMNS}`, [id, activo]));
    if (rows.length === 0) throw scheduleNotFound(id);
    return toSchedule(rows[0]);
  }

  // Generación de turnos -------------------------------------------------------

  /** Turnos diarios de los horarios activos, sin las fechas bloqueadas. Los que ya existen no cambian. */
  generateSlots(today: string, days: number, codigo: string | null = null): Promise<number> {
    return this.db.transaction(async (m) => {
      const rows: SlotRow[] = await m.query(
        `WITH nuevos AS (
           INSERT INTO disponibilidad (atr_codigo, hor_id, dis_fecha, dis_slot_codigo, dis_cupo_total)
           SELECT h.atr_codigo, h.hor_id, f.fecha::date, 'slot-' || to_char(f.fecha, 'YYYYMMDD') || '-' || to_char(h.hor_hora, 'HH24MI'), h.hor_cupo
           FROM horario h
           CROSS JOIN generate_series($1::date, $2::date, interval '1 day') AS f(fecha)
           WHERE h.hor_activo AND ($3::bpchar IS NULL OR h.atr_codigo = $3::bpchar)
             AND NOT EXISTS (SELECT 1 FROM fecha_bloqueada b WHERE b.atr_codigo = h.atr_codigo AND b.fb_fecha = f.fecha::date)
           ON CONFLICT DO NOTHING
           RETURNING dis_id, atr_codigo, hor_id, dis_slot_codigo, dis_fecha, dis_cupo_total, dis_cupo_reservado, dis_cerrada
         )
         SELECT n.dis_id, n.atr_codigo, n.dis_slot_codigo, n.dis_fecha::text AS dis_fecha, h.hor_hora::text AS hora,
                n.dis_cupo_total, n.dis_cupo_reservado, n.dis_cerrada
         FROM nuevos n JOIN horario h ON h.hor_id = n.hor_id`,
        [today, addDays(today, days), codigo],
      );
      // Un horario nuevo crea ~90 turnos: su stock va al outbox en una sola consulta.
      await recordNewSlotsStock(m, rows.map((row) => ({ ...toStock(row), dis_cupo_total: row.dis_cupo_total })));
      return rows.length;
    });
  }

  // Turnos ---------------------------------------------------------------------

  async slotsByIds(ids: number[]): Promise<Slot[]> {
    const rows: SlotRow[] = await this.db.query(`${SLOT_SELECT} WHERE d.dis_id = ANY($1::bigint[])`, [ids]);
    return rows.map(toSlot);
  }

  async listSlots(codigo: string, desde: string | null, hasta: string | null, page: number, limit: number): Promise<{ total: number; items: Slot[] }> {
    const where = `WHERE d.atr_codigo = $1 AND ($2::date IS NULL OR d.dis_fecha >= $2::date) AND ($3::date IS NULL OR d.dis_fecha <= $3::date)`;
    const params = [codigo, desde, hasta];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM disponibilidad d ${where}`, params);
    const rows: SlotRow[] = await this.db.query(`${SLOT_SELECT} ${where} ORDER BY d.dis_fecha, h.hor_hora LIMIT $4 OFFSET $5`, [...params, limit, (page - 1) * limit]);
    return { total, items: rows.map(toSlot) };
  }

  private async lockedSlot(codigo: string, slotCode: string, m: EntityManager): Promise<SlotRow> {
    const [row] = await m.query(`${SLOT_SELECT} WHERE d.atr_codigo = $1 AND d.dis_slot_codigo = $2 FOR UPDATE OF d`, [codigo, slotCode]);
    if (!row) throw slotNotFound(slotCode);
    return row;
  }

  setSlotCapacity(codigo: string, slotCode: string, cupoTotal: number): Promise<Slot> {
    return this.db.transaction(async (m) => {
      const row = await this.lockedSlot(codigo, slotCode, m);
      if (cupoTotal < row.dis_cupo_reservado) {
        throw AppError.conflict('CAPACITY_BELOW_RESERVED', `El turno ya tiene ${row.dis_cupo_reservado} cupos reservados.`);
      }
      await m.query(`UPDATE disponibilidad SET dis_cupo_total = $2 WHERE dis_id = $1`, [row.dis_id, cupoTotal]);
      const updated = { ...row, dis_cupo_total: cupoTotal };
      await recordStock(m, toStock(updated), 'push');
      return toSlot(updated);
    });
  }

  setSlotClosed(codigo: string, slotCode: string, cerrada: boolean): Promise<Slot> {
    return this.db.transaction(async (m) => {
      const row = await this.lockedSlot(codigo, slotCode, m);
      await m.query(`UPDATE disponibilidad SET dis_cerrada = $2 WHERE dis_id = $1`, [row.dis_id, cerrada]);
      const updated = { ...row, dis_cerrada: cerrada };
      await recordStock(m, toStock(updated), 'push');
      return toSlot(updated);
    });
  }

  // Fechas bloqueadas ----------------------------------------------------------

  async listBlockedDates(codigo: string, desde: string | null, hasta: string | null): Promise<BlockedDate[]> {
    const rows: { fb_fecha: string; fb_motivo: string }[] = await this.db.query(
      `SELECT fb_fecha::text AS fb_fecha, fb_motivo FROM fecha_bloqueada
       WHERE atr_codigo = $1 AND ($2::date IS NULL OR fb_fecha >= $2::date) AND ($3::date IS NULL OR fb_fecha <= $3::date)
       ORDER BY fb_fecha`,
      [codigo, desde, hasta],
    );
    return rows.map((row) => ({ atraccion_id: codigo, fecha: row.fb_fecha, motivo: row.fb_motivo }));
  }

  /** Cierra los turnos del día sin borrarlos: las reservas existentes siguen vigentes. */
  blockDate(codigo: string, fecha: string, motivo: string): Promise<BlockedDate> {
    return this.db.transaction(async (m) => {
      const inserted = await m.query(
        `INSERT INTO fecha_bloqueada (atr_codigo, fb_fecha, fb_motivo) VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT uq_fecha_bloqueada_atraccion_fecha DO NOTHING RETURNING fb_id`,
        [codigo, fecha, motivo],
      );
      if (inserted.length === 0) throw AppError.conflict('DATE_ALREADY_BLOCKED', `La fecha ${fecha} ya está bloqueada.`);
      await this.setDayClosed(codigo, fecha, true, m);
      return { atraccion_id: codigo, fecha, motivo };
    });
  }

  unblockDate(codigo: string, fecha: string): Promise<void> {
    return this.db.transaction(async (m) => {
      const rows = returnedRows(await m.query(`DELETE FROM fecha_bloqueada WHERE atr_codigo = $1 AND fb_fecha = $2 RETURNING fb_id`, [codigo, fecha]));
      if (rows.length === 0) throw AppError.notFound(`La fecha ${fecha} no está bloqueada.`, 'BLOCKED_DATE_NOT_FOUND');
      await this.setDayClosed(codigo, fecha, false, m);
    });
  }

  private async setDayClosed(codigo: string, fecha: string, cerrada: boolean, m: EntityManager): Promise<void> {
    await m.query(`UPDATE disponibilidad SET dis_cerrada = $3 WHERE atr_codigo = $1 AND dis_fecha = $2`, [codigo, fecha, cerrada]);
    const rows: SlotRow[] = await m.query(`${SLOT_SELECT} WHERE d.atr_codigo = $1 AND d.dis_fecha = $2`, [codigo, fecha]);
    for (const row of rows) await recordStock(m, toStock(row), 'push');
  }
}
