import { addDays, AppError, recordEvent, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { S, type Clock, type InventoryRepository } from './inventory-repository';

export interface AdminSlotRow {
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  cupos_totales: number;
  cupos_reservados: number;
  cupos_disponibles: number;
  cerrado: boolean;
  guia_codigo: string;
}

export interface TariffInput {
  atraccion_codigo: string;
  moneda: string;
  adult: number;
  child: number;
  senior: number;
  infant: number;
  student: number | null;
  vigente_desde: string;
}

const SLOT_COLUMNS = `t.atraccion_codigo, t.fecha::text AS fecha, t.hora::text AS hora, t.cupos_totales, t.cupos_reservados,
  t.cupos_totales - t.cupos_reservados AS cupos_disponibles, t.cerrado, coalesce(g.codigo, '') AS guia_codigo`;

const toSlot = (r: AdminSlotRow): AdminSlotRow => ({
  ...r, atraccion_codigo: r.atraccion_codigo.trim(), cupos_totales: Number(r.cupos_totales), cupos_reservados: Number(r.cupos_reservados), cupos_disponibles: Number(r.cupos_disponibles),
});

/**
 * Operaciones de administración del inventario (portal): turnos, aforo, cierre y tarifas. Todo cambio de cupos se
 * envía a Booking igual que una venta (contrato §2.2).
 */
export class InventoryAdminRepository {
  constructor(
    private readonly db: DataSource,
    private readonly inventory: InventoryRepository,
    private readonly clock: Clock,
  ) {}

  async listSlots(filters: { codigo: string | null; desde: string; hasta: string; limit: number; offset: number }): Promise<{ total: number; items: AdminSlotRow[] }> {
    const where = `($1::varchar IS NULL OR t.atraccion_codigo = $1) AND t.fecha BETWEEN $2::date AND $3::date`;
    const params = [filters.codigo, filters.desde, filters.hasta];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM ${S}.turnos_aforo t WHERE ${where}`, params);
    const rows = await this.db.query(
      `SELECT ${SLOT_COLUMNS} FROM ${S}.turnos_aforo t LEFT JOIN ${S}.guia g ON g.id = t.guia_id
        WHERE ${where} ORDER BY t.fecha, t.hora, t.atraccion_codigo LIMIT $4 OFFSET $5`,
      [...params, filters.limit, filters.offset],
    );
    return { total, items: rows.map(toSlot) };
  }

  async capacitySummary(desde: string, hasta: string): Promise<{ turnos: number; cupos_totales: number; cupos_reservados: number }> {
    const [row] = await this.db.query(
      `SELECT count(*)::int AS turnos, coalesce(sum(cupos_totales), 0)::int AS cupos_totales, coalesce(sum(cupos_reservados), 0)::int AS cupos_reservados
         FROM ${S}.turnos_aforo WHERE fecha BETWEEN $1::date AND $2::date AND NOT cerrado`,
      [desde, hasta],
    );
    return row;
  }

  /**
   * Crea los turnos de cada día del rango a las horas indicadas, o fija su aforo si ya existían (sin bajar de los cupos
   * vendidos). Los nuevos se envían a Booking con `StreamInventoryChanges` (delta = aforo) y los cambiados con
   * `PushStockUpdate`.
   */
  async upsertSlots(input: { codigo: string; desde: string; hasta: string; horas: string[]; cupos: number; guiaCodigo: string | null }): Promise<{ creados: number; actualizados: number }> {
    return this.db.transaction(async (m) => {
      const guiaId = input.guiaCodigo ? await this.guideId(m, input.guiaCodigo) : null;
      let creados = 0;
      let actualizados = 0;
      for (let fecha = input.desde; fecha <= input.hasta; fecha = addDays(fecha, 1)) {
        for (const hora of input.horas) {
          const [row] = await m.query(
            `INSERT INTO ${S}.turnos_aforo AS t (atraccion_codigo, fecha, hora, cupos_totales, guia_id) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT ON CONSTRAINT uq_turnos_aforo_turno DO UPDATE
               SET cupos_totales = greatest(t.cupos_reservados, EXCLUDED.cupos_totales), guia_id = coalesce(EXCLUDED.guia_id, t.guia_id),
                   version = t.version + 1, actualizado_en = now()
             RETURNING t.id, t.cupos_totales, t.cupos_totales - t.cupos_reservados AS disponibles, (xmax = 0) AS creado`,
            [input.codigo, fecha, hora, input.cupos, guiaId],
          );
          if (row.creado) {
            creados++;
            await m.query(
              `INSERT INTO ${S}.sincronizacion_booking (event_id, turno_id, metodo, delta, correlation_id) VALUES (gen_random_uuid(), $1, 'STREAM', $2, $3)`,
              [row.id, row.cupos_totales, 'administracion-de-turnos'],
            );
          } else {
            actualizados++;
            await this.inventory.stockChanged(m, { id: row.id, codigo: input.codigo, fecha, hora, totales: row.cupos_totales, disponibles: Number(row.disponibles) }, null);
          }
        }
      }
      return { creados, actualizados };
    });
  }

  /** Fija el aforo de un turno; no puede quedar por debajo de los cupos ya vendidos (409). */
  async setCapacity(codigo: string, fecha: string, hora: string, cupos: number): Promise<AdminSlotRow> {
    return this.db.transaction(async (m) => {
      const turno = await this.lockSlot(m, codigo, fecha, hora);
      if (cupos < turno.cupos_reservados) {
        throw AppError.conflict('CAPACITY_BELOW_SOLD', `El turno ya tiene ${turno.cupos_reservados} cupos vendidos: el aforo no puede ser menor.`);
      }
      const [row] = returnedRows<{ cupos_totales: number; disponibles: number }>(await m.query(
        `UPDATE ${S}.turnos_aforo SET cupos_totales = $2, version = version + 1, actualizado_en = now()
          WHERE id = $1 RETURNING cupos_totales, cupos_totales - cupos_reservados AS disponibles`,
        [turno.id, cupos],
      ));
      await this.inventory.stockChanged(m, { id: turno.id, codigo, fecha, hora, totales: row.cupos_totales, disponibles: turno.cerrado ? 0 : Number(row.disponibles) }, null);
      return this.slot(m, turno.id);
    });
  }

  /** Cierra o reabre la venta de un turno. Cerrado, Booking lo recibe con 0 cupos disponibles. */
  async setClosed(codigo: string, fecha: string, hora: string, cerrado: boolean): Promise<AdminSlotRow> {
    return this.db.transaction(async (m) => {
      const turno = await this.lockSlot(m, codigo, fecha, hora);
      await m.query(`UPDATE ${S}.turnos_aforo SET cerrado = $2, version = version + 1, actualizado_en = now() WHERE id = $1`, [turno.id, cerrado]);
      await this.inventory.stockChanged(m, {
        id: turno.id, codigo, fecha, hora, totales: turno.cupos_totales, disponibles: cerrado ? 0 : turno.cupos_totales - turno.cupos_reservados,
      }, null);
      return this.slot(m, turno.id);
    });
  }

  /**
   * Nueva tarifa desde una fecha (hoy o futura): cierra la vigente el día anterior y reemplaza las que empezaban después.
   * Publica `TarifaActualizada` (Catalog replica el precio de adulto para los filtros por precio).
   */
  async setTariff(input: TariffInput): Promise<void> {
    const today = this.clock.now().date;
    if (input.vigente_desde < today) throw AppError.validation('La tarifa no puede empezar en el pasado.', [{ name: 'vigente_desde', reason: `Debe ser ${today} o posterior.` }]);
    await this.db.transaction(async (m) => {
      await m.query(`DELETE FROM ${S}.tarifa WHERE atraccion_codigo = $1 AND vigente_desde >= $2::date`, [input.atraccion_codigo, input.vigente_desde]);
      await m.query(
        `UPDATE ${S}.tarifa SET vigente_hasta = $2::date - 1
          WHERE atraccion_codigo = $1 AND vigente_desde < $2::date AND (vigente_hasta IS NULL OR vigente_hasta >= $2::date)`,
        [input.atraccion_codigo, input.vigente_desde],
      );
      const [tarifa] = await m.query(
        `INSERT INTO ${S}.tarifa (atraccion_codigo, moneda, vigente_desde) VALUES ($1, $2, $3) RETURNING id`,
        [input.atraccion_codigo, input.moneda, input.vigente_desde],
      );
      const prices: [string, number | null][] = [['ADULT', input.adult], ['CHILD', input.child], ['SENIOR', input.senior], ['INFANT', input.infant], ['STUDENT', input.student]];
      for (const [tipo, precio] of prices) {
        if (precio !== null) await m.query(`INSERT INTO ${S}.tarifa_precio (tarifa_id, tipo_boleto, precio) VALUES ($1, $2, $3)`, [tarifa.id, tipo, precio]);
      }
      await recordEvent(m, {
        tipoEvento: 'TarifaActualizada',
        agregadoId: input.atraccion_codigo,
        payload: { ...input, vigente_hoy: input.vigente_desde <= today },
      }, S);
    });
  }

  private async lockSlot(m: EntityManager, codigo: string, fecha: string, hora: string) {
    const [turno] = await m.query(
      `SELECT id, cupos_totales, cupos_reservados, cerrado FROM ${S}.turnos_aforo WHERE atraccion_codigo = $1 AND fecha = $2::date AND hora = $3::time FOR UPDATE`,
      [codigo, fecha, hora],
    );
    if (!turno) throw AppError.notFound(`No existe el turno ${codigo} del ${fecha} a las ${hora}.`, 'SLOT_NOT_FOUND');
    return turno as { id: string; cupos_totales: number; cupos_reservados: number; cerrado: boolean };
  }

  private async slot(m: EntityManager, id: string): Promise<AdminSlotRow> {
    const [row] = await m.query(`SELECT ${SLOT_COLUMNS} FROM ${S}.turnos_aforo t LEFT JOIN ${S}.guia g ON g.id = t.guia_id WHERE t.id = $1`, [id]);
    return toSlot(row);
  }

  private async guideId(m: EntityManager, codigo: string): Promise<string> {
    const [row] = await m.query(`SELECT id FROM ${S}.guia WHERE codigo = $1`, [codigo]);
    if (!row) throw AppError.validation(`No existe el guía ${codigo}.`, [{ name: 'guia_codigo', reason: 'Guía inexistente.' }], 'GUIDE_NOT_FOUND');
    return row.id;
  }
}
