import type { DataSource } from 'typeorm';

export interface AvailableSlotRow {
  dis_slot_codigo: string;
  hora: string;
  dis_cupo_total: number;
  dis_cupo_reservado: number;
}

/** Solo se ofrecen turnos abiertos cuya hora no pasó. */
const OFFERED = `NOT d.dis_cerrada AND (d.dis_fecha > $2::date OR (d.dis_fecha = $2::date AND h.hor_hora > $3::time))`;

export class AvailabilityRepository {
  constructor(private readonly db: DataSource) {}

  async hasSchedules(codigo: string): Promise<boolean> {
    const [row] = await this.db.query(`SELECT 1 FROM horario WHERE atr_codigo = $1 LIMIT 1`, [codigo]);
    return Boolean(row);
  }

  slots(codigo: string, date: string, today: string, now: string): Promise<AvailableSlotRow[]> {
    return this.db.query(
      `SELECT d.dis_slot_codigo, h.hor_hora::text AS hora, d.dis_cupo_total, d.dis_cupo_reservado
       FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id
       WHERE d.atr_codigo = $1 AND d.dis_fecha = $4::date AND ${OFFERED}
       ORDER BY h.hor_hora`,
      [codigo, today, now, date],
    );
  }

  /** Atracciones de la lista con cupos entre dos fechas. */
  async withSeats(codigos: string[], from: string, to: string, today: string, now: string): Promise<string[]> {
    const rows: { atr_codigo: string }[] = await this.db.query(
      `SELECT DISTINCT d.atr_codigo
       FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id
       WHERE d.atr_codigo = ANY($1::char(12)[]) AND d.dis_fecha BETWEEN $4::date AND $5::date
         AND d.dis_cupo_reservado < d.dis_cupo_total AND ${OFFERED}`,
      [codigos, today, now, from, to],
    );
    return rows.map((row) => row.atr_codigo);
  }
}
