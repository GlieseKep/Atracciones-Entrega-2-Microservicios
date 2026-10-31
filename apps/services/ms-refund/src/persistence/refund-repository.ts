import { randomInt } from 'node:crypto';
import { AppError, money, recordEvent } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { ReembolsoDto, ReembolsoInput } from '../contract';

interface RefundRow {
  rem_numero: string;
  pag_id: string;
  rem_monto: string;
  rem_motivo: string | null;
  rem_referencia: string | null;
  rem_solicitado_en: Date;
  rem_procesado_en: Date;
}

const COLUMNS = 'rem_numero, pag_id, rem_monto, rem_motivo, rem_referencia, rem_solicitado_en, rem_procesado_en';

const toDto = (row: RefundRow): ReembolsoDto => ({
  reembolso_id: row.rem_numero,
  pag_id: Number(row.pag_id),
  monto_reembolsado: Number(row.rem_monto),
  motivo: row.rem_motivo,
  referencia: row.rem_referencia,
  solicitado_en: row.rem_solicitado_en.toISOString(),
  procesado_en: row.rem_procesado_en.toISOString(),
});

const newRefundNumber = () => `REF-ATR-${Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('')}`;

export interface ApprovedPayment {
  id: number;
  monto: number;
}

export class RefundRepository {
  constructor(private readonly db: DataSource) {}

  async findByKey(clave: string): Promise<ReembolsoDto | null> {
    const [row] = await this.db.query(`SELECT ${COLUMNS} FROM reembolso WHERE rem_clave_idempotencia = $1`, [clave]);
    return row ? toDto(row) : null;
  }

  async findByNumber(numero: string): Promise<ReembolsoDto | null> {
    const [row] = await this.db.query(`SELECT ${COLUMNS} FROM reembolso WHERE rem_numero = $1`, [numero]);
    return row ? toDto(row) : null;
  }

  async list(pagId: number | null, page: number, limit: number): Promise<{ total: number; items: ReembolsoDto[] }> {
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM reembolso WHERE $1::bigint IS NULL OR pag_id = $1`, [pagId]);
    const rows: RefundRow[] = await this.db.query(
      `SELECT ${COLUMNS} FROM reembolso WHERE $1::bigint IS NULL OR pag_id = $1 ORDER BY rem_creado_en DESC, rem_id DESC LIMIT $2 OFFSET $3`,
      [pagId, limit, (page - 1) * limit],
    );
    return { total, items: rows.map(toDto) };
  }

  /**
   * Bajo un bloqueo por `pag_id`, calcula el saldo, crea la fila y `ReembolsoEmitido`. La pasarela es simulada: el reembolso
   * se procesa aquí mismo, sin estados intermedios. Con `null`, otra petición con la misma clave se adelantó.
   */
  async emit(payment: ApprovedPayment, input: ReembolsoInput, clave: string): Promise<ReembolsoDto | null> {
    try {
      return await this.db.transaction(async (m) => {
        await m.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [payment.id]);
        const [{ devuelto }] = await m.query(`SELECT COALESCE(sum(rem_monto), 0)::float8 AS devuelto FROM reembolso WHERE pag_id = $1`, [payment.id]);
        const saldo = money(payment.monto - devuelto);
        const monto = input.monto === null ? saldo : money(input.monto);
        if (saldo <= 0 || monto > saldo) throw AppError.conflict('REFUND_EXCEEDS_BALANCE', `El saldo por devolver es ${saldo}.`);
        const numero = newRefundNumber();
        const [row] = await m.query(
          `INSERT INTO reembolso (pag_id, rem_numero, rem_monto, rem_motivo, rem_referencia, rem_clave_idempotencia, rem_procesado_en)
           VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING ${COLUMNS}`,
          [payment.id, numero, monto, input.motivo, `SIM-${numero}`, clave],
        );
        const acumulado = money(devuelto + monto);
        await recordEvent(m, {
          tipoEvento: 'ReembolsoEmitido',
          agregadoId: numero,
          payload: { reembolso_id: numero, pag_id: payment.id, ord_id: input.ord_id, monto, monto_acumulado: acumulado },
        });
        return { ...toDto(row), ord_id: input.ord_id, monto_acumulado: acumulado };
      });
    } catch (error) {
      const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
      if (driver?.code === '23505' && driver.constraint === 'reembolso_rem_clave_idempotencia_key') return null;
      throw error;
    }
  }
}
