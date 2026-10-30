import { AppError, recordEvent, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { TariffRow } from '../application/price-table';
import type { TicketType } from '../contract';

type Db = DataSource | EntityManager;

const COLUMNS = `tar_id, atr_codigo, tar_tipo, tar_precio::float8 AS tar_precio, tar_moneda::text AS tar_moneda,
  tar_vigente_desde::text AS valid_from, tar_vigente_hasta::text AS valid_to`;

const toRow = (r: TariffRow): TariffRow => ({ ...r, tar_id: Number(r.tar_id), atr_codigo: r.atr_codigo.trim() });

/** Vigente en `$date`: empezó ese día o antes y no terminó antes. */
const CURRENT_AT = (dateParam: string) => `tar_vigente_desde <= ${dateParam}::date AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= ${dateParam}::date)`;

export interface TariffVersion {
  code: string;
  type: TicketType;
  price: number;
  currency: string;
  from: string;
  to: string | null;
}

const driverCode = (error: unknown) => (error as { driverError?: { code?: string } }).driverError?.code;

/** Tarifas versionadas: una fila por atracción, tipo de boleto y vigencia. */
export class PricingRepository {
  constructor(private readonly db: DataSource) {}

  /** Tarifas vigentes en `date` de varias atracciones (una consulta, para listados). */
  async currentRows(codes: string[], date: string, m: Db = this.db): Promise<TariffRow[]> {
    if (!codes.length) return [];
    const rows: TariffRow[] = await m.query(
      `SELECT ${COLUMNS} FROM tarifa WHERE atr_codigo = ANY($1::char(12)[]) AND ${CURRENT_AT('$2')} ORDER BY atr_codigo, tar_tipo`,
      [codes, date],
    );
    return rows.map(toRow);
  }

  /** Versiones de una atracción: vigentes y futuras, o todas con `includeHistory`. */
  async list(code: string, includeHistory: boolean, today: string): Promise<TariffRow[]> {
    const rows: TariffRow[] = await this.db.query(
      `SELECT ${COLUMNS} FROM tarifa
        WHERE atr_codigo = $1 AND ($2 OR tar_vigente_hasta IS NULL OR tar_vigente_hasta >= $3::date)
        ORDER BY tar_tipo, tar_vigente_desde`,
      [code, includeHistory, today],
    );
    return rows.map(toRow);
  }

  async getById(id: number, m: Db = this.db, lock = false): Promise<TariffRow | null> {
    const [row] = await m.query(`SELECT ${COLUMNS} FROM tarifa WHERE tar_id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return row ? toRow(row) : null;
  }

  /**
   * Ejecuta un cambio de tarifas en una transacción. Un solape entre versiones (la restricción de exclusión) se informa
   * como `TARIFF_OVERLAP`.
   */
  async change<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (driverCode(error) === '23P01') {
        throw AppError.unprocessable('TARIFF_OVERLAP', 'La vigencia se cruza con otra versión de la misma tarifa (probablemente una versión futura). Ciérrela o ajuste las fechas.');
      }
      throw error;
    }
  }

  /**
   * Nueva versión de una tarifa desde `from`: si ya hay una que empieza ese mismo día se reemplaza; si no, la versión
   * vigente en `from` se cierra el día anterior y se inserta la nueva.
   */
  async putVersion(m: EntityManager, v: TariffVersion): Promise<TariffRow> {
    const [same] = await m.query(
      `SELECT tar_id FROM tarifa WHERE atr_codigo = $1 AND tar_tipo = $2 AND tar_vigente_desde = $3::date FOR UPDATE`,
      [v.code, v.type, v.from],
    );
    if (same) {
      const [row] = returnedRows<TariffRow>(await m.query(
        `UPDATE tarifa SET tar_precio = $2, tar_moneda = $3, tar_vigente_hasta = $4 WHERE tar_id = $1 RETURNING ${COLUMNS}`,
        [same.tar_id, v.price, v.currency, v.to],
      ));
      return toRow(row);
    }
    await this.closeCurrentBefore(m, v.code, v.type, v.from);
    const [row] = await m.query(
      `INSERT INTO tarifa (atr_codigo, tar_tipo, tar_precio, tar_moneda, tar_vigente_desde, tar_vigente_hasta)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [v.code, v.type, v.price, v.currency, v.from, v.to],
    );
    return toRow(row);
  }

  /** Deja de tener tarifa de ese tipo desde `from`: quita la versión que empezaba ese día y cierra la vigente. */
  async endType(m: EntityManager, code: string, type: TicketType, from: string): Promise<void> {
    await m.query(`DELETE FROM tarifa WHERE atr_codigo = $1 AND tar_tipo = $2 AND tar_vigente_desde = $3::date`, [code, type, from]);
    await this.closeCurrentBefore(m, code, type, from);
  }

  /** Cambia el fin de vigencia de una tarifa. */
  async setValidTo(m: EntityManager, id: number, to: string): Promise<TariffRow> {
    const [row] = returnedRows<TariffRow>(await m.query(`UPDATE tarifa SET tar_vigente_hasta = $2 WHERE tar_id = $1 RETURNING ${COLUMNS}`, [id, to]));
    return toRow(row);
  }

  /** Registra `TARIFA_ACTUALIZADA` en el outbox, en la misma transacción que el cambio. */
  async recordTariffUpdated(m: EntityManager, code: string, payload: Record<string, unknown>): Promise<void> {
    await recordEvent(m, { tipoEvento: 'TARIFA_ACTUALIZADA', agregadoId: code, payload });
  }

  private async closeCurrentBefore(m: EntityManager, code: string, type: TicketType, from: string): Promise<void> {
    await m.query(
      `UPDATE tarifa SET tar_vigente_hasta = $3::date - 1
        WHERE atr_codigo = $1 AND tar_tipo = $2 AND tar_vigente_desde < $3::date AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= $3::date)`,
      [code, type, from],
    );
  }
}
