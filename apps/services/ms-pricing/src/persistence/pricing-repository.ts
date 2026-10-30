import { AppError, addDays, recordEvent } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { PriceTableInput, TicketType } from '../contract';
import { priceTableOf, tariffUpdatedPayload } from '../application/price-table';

export type Db = DataSource | EntityManager;

export interface TariffRow {
  tar_id: string;
  atr_codigo: string;
  tar_tipo: TicketType;
  tar_precio: string;
  tar_moneda: string;
  tar_vigente_desde: string;
  tar_vigente_hasta: string | null;
}

/** Las columnas DATE se leen como texto: convertirlas a `Date` las movería de día según la zona horaria. */
const COLUMNS = `tar_id, atr_codigo, tar_tipo, tar_precio, tar_moneda, tar_vigente_desde::text AS tar_vigente_desde, tar_vigente_hasta::text AS tar_vigente_hasta`;

const overlap = () => AppError.unprocessable('TARIFF_OVERLAP', 'Ya existe una versión posterior de esta tarifa.');

export class PricingRepository {
  constructor(private readonly db: DataSource) {}

  /** Filas vigentes de una atracción en una fecha. */
  forDate(codigo: string, date: string, db: Db = this.db): Promise<TariffRow[]> {
    return db.query(
      `SELECT ${COLUMNS} FROM tarifa
       WHERE atr_codigo = $1 AND tar_vigente_desde <= $2::date AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= $2::date)`,
      [codigo, date],
    );
  }

  list(codigo: string, includeHistory: boolean, today: string): Promise<TariffRow[]> {
    return this.db.query(
      `SELECT ${COLUMNS} FROM tarifa
       WHERE atr_codigo = $1 AND ($2::boolean OR tar_vigente_hasta IS NULL OR tar_vigente_hasta >= $3::date)
       ORDER BY tar_vigente_desde DESC, tar_tipo`,
      [codigo, includeHistory, today],
    );
  }

  /**
   * Guarda una tabla completa: cierra la anterior el día previo e inserta una fila por tipo. Con la misma `valid_from`
   * reemplaza los precios. Si rige hoy, escribe `TARIFA_ACTUALIZADA` en la misma transacción.
   */
  setPriceTable(input: PriceTableInput, today: string): Promise<TariffRow[]> {
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [input.codigo]);
      const [later] = await m.query(`SELECT 1 FROM tarifa WHERE atr_codigo = $1 AND tar_vigente_desde > $2::date LIMIT 1`, [input.codigo, input.validFrom]);
      if (later) throw overlap();
      await m.query(`DELETE FROM tarifa WHERE atr_codigo = $1 AND tar_vigente_desde = $2::date`, [input.codigo, input.validFrom]);
      await m.query(
        `UPDATE tarifa SET tar_vigente_hasta = $3::date
         WHERE atr_codigo = $1 AND tar_vigente_desde < $2::date AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= $2::date)`,
        [input.codigo, input.validFrom, addDays(input.validFrom, -1)],
      );
      for (const [tipo, precio] of Object.entries(input.prices)) {
        await m.query(`INSERT INTO tarifa (atr_codigo, tar_tipo, tar_precio, tar_vigente_desde) VALUES ($1, $2, $3, $4::date)`, [input.codigo, tipo, precio, input.validFrom]);
      }
      const rows = await this.forDate(input.codigo, input.validFrom, m);
      if (input.validFrom === today) await this.recordUpdated(input.codigo, today, m);
      return rows;
    });
  }

  private async recordUpdated(codigo: string, today: string, m: EntityManager): Promise<void> {
    const rows = await this.forDate(codigo, today, m);
    const table = priceTableOf(codigo, today, rows);
    if (table) await recordEvent(m, { tipoEvento: 'TARIFA_ACTUALIZADA', agregadoId: codigo, payload: tariffUpdatedPayload(table) });
  }

  /** `TARIFA_ACTUALIZADA` de las atracciones cuya tarifa empezó entre `from` y hoy. Devuelve cuántas son. */
  async publishEffective(from: string, today: string): Promise<number> {
    const rows: { atr_codigo: string }[] = await this.db.query(
      `SELECT DISTINCT atr_codigo FROM tarifa WHERE tar_vigente_desde BETWEEN $1::date AND $2::date`,
      [from, today],
    );
    await this.db.transaction(async (m) => {
      for (const row of rows) await this.recordUpdated(row.atr_codigo, today, m);
    });
    return rows.length;
  }
}
