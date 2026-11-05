import { AppError, recordEvent, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { ReleaseSeatsResponse, ReserveSeatsResponse } from '../contract';
import { recordStock, type SlotStock } from './stock-outbox';

interface SeatRow extends SlotStock {
  dis_id: string;
  gui_id: string | null;
}

/** `RETURNING` de `disponibilidad` con lo que necesitan los eventos y la compra (guía del turno). */
const RETURNING = `RETURNING dis_id, atr_codigo, dis_slot_codigo, dis_fecha::text AS dis_fecha,
  (SELECT hor_hora::text FROM horario h WHERE h.hor_id = disponibilidad.hor_id) AS hora,
  dis_cupo_total - dis_cupo_reservado AS disponibles, gui_id`;

const guideOf = (value: string | null | undefined) => (value === null || value === undefined ? null : Number(value));

export class SeatRepository {
  constructor(private readonly db: DataSource) {}

  private async recordChange(m: EntityManager, tipoEvento: 'CupoBloqueado' | 'CupoLiberado', row: SeatRow, cantidad: number): Promise<void> {
    await recordEvent(m, {
      tipoEvento,
      agregadoId: row.atr_codigo,
      payload: {
        dis_id: Number(row.dis_id),
        atraccion_id: row.atr_codigo,
        slot_id: row.dis_slot_codigo,
        fecha: row.dis_fecha,
        cantidad,
        cupos_disponibles: row.disponibles,
      },
    });
    await recordStock(m, row, 'push');
  }

  /** Descuento atómico: sin cupos, el `UPDATE` no toca filas. Con una clave repetida responde lo mismo, sin descontar. */
  reserve(codigo: string, slotCode: string, cantidad: number, clave: string): Promise<ReserveSeatsResponse> {
    return this.db.transaction(async (m) => {
      const [slot] = await m.query(`SELECT dis_id FROM disponibilidad WHERE atr_codigo = $1 AND dis_slot_codigo = $2`, [codigo, slotCode]);
      if (!slot) throw AppError.validation(`El turno ${slotCode} no pertenece a la atracción ${codigo}.`, undefined, 'SLOT_TIME_MISMATCH');
      const inserted = await m.query(
        `INSERT INTO bloqueo_cupo (dis_id, blo_clave, blo_cantidad) VALUES ($1, $2, $3) ON CONFLICT (blo_clave) DO NOTHING RETURNING blo_id`,
        [slot.dis_id, clave, cantidad],
      );
      if (inserted.length === 0) {
        const [previous] = await m.query(
          `SELECT d.dis_id, d.dis_slot_codigo, d.dis_cupo_total - d.dis_cupo_reservado AS disponibles, d.gui_id
           FROM bloqueo_cupo b JOIN disponibilidad d ON d.dis_id = b.dis_id WHERE b.blo_clave = $1`,
          [clave],
        );
        return { dis_id: Number(previous.dis_id), slot_id: previous.dis_slot_codigo, cupos_disponibles: previous.disponibles, gui_id: guideOf(previous.gui_id) };
      }
      const rows = returnedRows<SeatRow>(
        await m.query(
          `UPDATE disponibilidad SET dis_cupo_reservado = dis_cupo_reservado + $2
           WHERE dis_id = $1 AND NOT dis_cerrada AND dis_cupo_reservado + $2 <= dis_cupo_total ${RETURNING}`,
          [slot.dis_id, cantidad],
        ),
      );
      if (rows.length === 0) throw AppError.conflict('OUT_OF_STOCK', `No hay ${cantidad} cupos disponibles en el turno ${slotCode}.`);
      await this.recordChange(m, 'CupoBloqueado', rows[0], cantidad);
      return { dis_id: Number(rows[0].dis_id), slot_id: rows[0].dis_slot_codigo, cupos_disponibles: rows[0].disponibles, gui_id: guideOf(rows[0].gui_id) };
    });
  }

  /** Reintegra una sola vez. Una clave desconocida no es error: la saga puede compensar un descuento que nunca ocurrió. */
  release(clave: string): Promise<ReleaseSeatsResponse> {
    return this.db.transaction(async (m) => {
      const blocks = returnedRows<{ dis_id: string; blo_cantidad: number }>(
        await m.query(`UPDATE bloqueo_cupo SET blo_liberado_en = now() WHERE blo_clave = $1 AND blo_liberado_en IS NULL RETURNING dis_id, blo_cantidad`, [clave]),
      );
      if (blocks.length === 0) {
        const [row] = await m.query(
          `SELECT d.dis_cupo_total - d.dis_cupo_reservado AS disponibles FROM bloqueo_cupo b JOIN disponibilidad d ON d.dis_id = b.dis_id WHERE b.blo_clave = $1`,
          [clave],
        );
        return { liberado: false, cupos_disponibles: row?.disponibles ?? 0 };
      }
      const [block] = blocks;
      const rows = returnedRows<SeatRow>(
        await m.query(`UPDATE disponibilidad SET dis_cupo_reservado = dis_cupo_reservado - $2 WHERE dis_id = $1 ${RETURNING}`, [block.dis_id, block.blo_cantidad]),
      );
      await this.recordChange(m, 'CupoLiberado', rows[0], block.blo_cantidad);
      return { liberado: true, cupos_disponibles: rows[0].disponibles };
    });
  }
}
