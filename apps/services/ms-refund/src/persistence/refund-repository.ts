import { recordEvent, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { RefundFilters } from '../application/refund-input';
import type { PaymentRefundsDto, ReembolsoEmitidoPayload, RefundDto, RefundResultDto, Solicitante } from '../contract';

const COLUMNS = `rem_numero AS codigo, pag_id AS pago_id, ord_id AS orden_id, rem_monto AS monto, rem_moneda AS moneda, rem_motivo AS motivo,
  rem_solicitante AS solicitante, rem_estado AS estado, rem_referencia AS referencia, rem_solicitado_en AS solicitado_en,
  CASE WHEN rem_estado = 'EMITIDO' THEN rem_procesado_en END AS emitido_en`;

/** `numeric` llega como texto y las fechas como `Date` desde `pg`. */
const toDto = (row: Record<string, unknown>): RefundDto => ({
  ...(row as unknown as RefundDto),
  monto: Number(row.monto),
  solicitado_en: new Date(row.solicitado_en as string).toISOString(),
  emitido_en: row.emitido_en ? new Date(row.emitido_en as string).toISOString() : null,
});

export interface NewRefund {
  paymentId: string;
  orderId: string;
  code: string;
  amount: number;
  currency: string;
  reason: string;
  requester: Solicitante;
  idempotencyKey: string;
}

/** Reembolsos. Lo comprometido por pago (`v_pago_reembolsado`) cuenta los EMITIDO y los PENDIENTE. */
export class RefundRepository {
  constructor(private readonly db: DataSource) {}

  /** Resultado guardado para una clave de idempotencia (respuesta de un reintento). */
  async byKey(key: string, m: EntityManager | DataSource = this.db): Promise<RefundResultDto | null> {
    const [row] = await m.query(`SELECT rem_numero, rem_monto, rem_estado FROM reembolso WHERE rem_clave_idempotencia = $1`, [key]);
    return row ? { reembolso_codigo: row.rem_numero, monto: Number(row.rem_monto), estado: row.rem_estado } : null;
  }

  /** Reembolso que quedó en PENDIENTE para una clave (el proceso se cortó antes de hablar con la pasarela). */
  async pendingByKey(key: string): Promise<{ code: string; amount: number; currency: string; paymentId: string } | null> {
    const [row] = await this.db.query(
      `SELECT rem_numero, rem_monto, rem_moneda, pag_id FROM reembolso WHERE rem_clave_idempotencia = $1 AND rem_estado = 'PENDIENTE'`,
      [key],
    );
    return row ? { code: row.rem_numero, amount: Number(row.rem_monto), currency: row.rem_moneda, paymentId: row.pag_id } : null;
  }

  /** Bloquea los reembolsos de un pago hasta el fin de la transacción (dos solicitudes no superan el saldo). */
  async lockPayment(m: EntityManager, paymentId: string): Promise<void> {
    await m.query(`SELECT pg_advisory_xact_lock(hashtext('reembolso:' || $1))`, [paymentId]);
  }

  /** Monto ya comprometido (EMITIDO + PENDIENTE) de un pago. */
  async committed(m: EntityManager, paymentId: string): Promise<number> {
    const [row] = await m.query(`SELECT comprometido FROM v_pago_reembolsado WHERE pag_id = $1`, [paymentId]);
    return Number(row?.comprometido ?? 0);
  }

  /** Registra el reembolso en PENDIENTE: el monto queda comprometido antes de hablar con la pasarela. */
  async insertPending(m: EntityManager, r: NewRefund): Promise<void> {
    await m.query(
      `INSERT INTO reembolso (pag_id, ord_id, rem_numero, rem_monto, rem_moneda, rem_motivo, rem_solicitante, rem_clave_idempotencia)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.paymentId, r.orderId, r.code, r.amount, r.currency, r.reason, r.requester, r.idempotencyKey],
    );
  }

  /** EMITIDO con la referencia de la pasarela, y `ReembolsoEmitido` en el outbox en la misma transacción. */
  async markIssued(code: string, reference: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const [row] = returnedRows<Record<string, unknown>>(await m.query(
        `UPDATE reembolso SET rem_estado = 'EMITIDO', rem_referencia = $2, rem_procesado_en = now()
          WHERE rem_numero = $1 AND rem_estado = 'PENDIENTE'
          RETURNING rem_numero, pag_id, ord_id, rem_monto`,
        [code, reference],
      ));
      if (!row) return;
      const payload: ReembolsoEmitidoPayload = {
        reembolso_codigo: String(row.rem_numero), pago_id: String(row.pag_id), orden_id: String(row.ord_id), monto: Number(row.rem_monto),
      };
      await recordEvent(m, { tipoEvento: 'ReembolsoEmitido', agregadoId: payload.reembolso_codigo, payload: { ...payload } });
    });
  }

  /** FALLIDO: el monto deja de estar comprometido. */
  async markFailed(code: string): Promise<void> {
    await this.db.query(
      `UPDATE reembolso SET rem_estado = 'FALLIDO', rem_procesado_en = now() WHERE rem_numero = $1 AND rem_estado = 'PENDIENTE'`,
      [code],
    );
  }

  async list(filters: RefundFilters): Promise<{ total: number; items: RefundDto[] }> {
    const where = `($1::varchar IS NULL OR rem_estado = $1) AND ($2::date IS NULL OR rem_solicitado_en >= $2::date)
      AND ($3::date IS NULL OR rem_solicitado_en < $3::date + 1)`;
    const params = [filters.status, filters.from, filters.to];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM reembolso WHERE ${where}`, params);
    const rows = await this.db.query(
      `SELECT ${COLUMNS} FROM reembolso WHERE ${where} ORDER BY rem_solicitado_en DESC, rem_id DESC LIMIT $4 OFFSET $5`,
      [...params, filters.limit, filters.offset],
    );
    return { total, items: rows.map(toDto) };
  }

  async get(code: string): Promise<RefundDto | null> {
    const [row] = await this.db.query(`SELECT ${COLUMNS} FROM reembolso WHERE rem_numero = $1`, [code]);
    return row ? toDto(row) : null;
  }

  async byOrder(orderId: string): Promise<RefundDto[]> {
    const rows = await this.db.query(`SELECT ${COLUMNS} FROM reembolso WHERE ord_id = $1 ORDER BY rem_creado_en, rem_id`, [orderId]);
    return rows.map(toDto);
  }

  /** Reembolsos agrupados por pago, en el orden pedido; los pagos sin reembolsos vienen con lista vacía. */
  async byPayments(paymentIds: string[]): Promise<PaymentRefundsDto[]> {
    const rows = await this.db.query(
      `SELECT ${COLUMNS} FROM reembolso WHERE pag_id = ANY($1::uuid[]) ORDER BY rem_creado_en, rem_id`,
      [paymentIds],
    );
    const refunds = rows.map(toDto);
    return paymentIds.map((id) => {
      const own = refunds.filter((r: RefundDto) => r.pago_id === id);
      const issued = own.filter((r: RefundDto) => r.estado === 'EMITIDO').reduce((sum: number, r: RefundDto) => sum + r.monto, 0);
      return { pago_id: id, reembolsado: Math.round(issued * 100) / 100, reembolsos: own };
    });
  }
}
