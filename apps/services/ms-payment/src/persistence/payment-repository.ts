import { AppError, recordEvent } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { EstadoPago, MetodoCodigo, MetodoPagoDto, PagoDto, PagoInput, PaymentResult, TransferenciaInput } from '../contract';

interface PaymentRow {
  pag_id: string;
  pag_numero: string;
  ord_id: string;
  mpa_codigo: MetodoCodigo;
  est_codigo: EstadoPago;
  pag_monto: string;
  pag_referencia: string | null;
  pag_autorizacion: string | null;
  pag_motivo_rechazo: string | null;
  pag_fecha: Date;
  pag_aprobado_en: Date | null;
  pag_rechazado_en: Date | null;
}

const SELECT = `SELECT p.pag_id, p.pag_numero, p.ord_id, m.mpa_codigo, e.est_codigo, p.pag_monto, p.pag_referencia, p.pag_autorizacion,
    p.pag_motivo_rechazo, p.pag_fecha, p.pag_aprobado_en, p.pag_rechazado_en
  FROM pago p JOIN metodo_pago m ON m.mpa_id = p.mpa_id JOIN estado e ON e.est_id = p.est_id`;

const toDto = (row: PaymentRow): PagoDto => ({
  id: Number(row.pag_id),
  numero: row.pag_numero,
  ord_id: Number(row.ord_id),
  metodo: row.mpa_codigo,
  estado: row.est_codigo,
  monto: Number(row.pag_monto),
  referencia: row.pag_referencia,
  autorizacion: row.pag_autorizacion,
  motivo_rechazo: row.pag_motivo_rechazo,
  fecha: row.pag_fecha.toISOString(),
  aprobado_en: row.pag_aprobado_en?.toISOString() ?? null,
  rechazado_en: row.pag_rechazado_en?.toISOString() ?? null,
});

const alreadyApproved = () => AppError.conflict('PAYMENT_ALREADY_APPROVED', 'La orden ya tiene un pago aprobado: se devuelve con Refund.');
const isApprovedConflict = (error: unknown) => {
  const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
  return driver?.code === '23505' && driver.constraint === 'ux_pago_orden_aprobado';
};

const estado = (codigo: EstadoPago) => `(SELECT est_id FROM estado WHERE est_codigo = '${codigo}')`;

export class PaymentRepository {
  constructor(private readonly db: DataSource) {}

  async listMethods(): Promise<MetodoPagoDto[]> {
    const rows: { mpa_id: number; mpa_codigo: MetodoCodigo; mpa_nombre: string; mpa_requiere_datos: boolean }[] = await this.db.query(
      `SELECT mpa_id, mpa_codigo, mpa_nombre, mpa_requiere_datos FROM metodo_pago WHERE mpa_activo ORDER BY mpa_id`,
    );
    return rows.map((row) => ({ id: row.mpa_id, codigo: row.mpa_codigo, nombre: row.mpa_nombre, requiere_datos: row.mpa_requiere_datos }));
  }

  async findById(id: number, db: DataSource | EntityManager = this.db): Promise<PagoDto | null> {
    const [row] = await db.query(`${SELECT} WHERE p.pag_id = $1`, [id]);
    return row ? toDto(row) : null;
  }

  async findByNumber(numero: string): Promise<PagoDto | null> {
    const [row] = await this.db.query(`${SELECT} WHERE p.pag_numero = $1`, [numero]);
    return row ? toDto(row) : null;
  }

  async listByOrder(ordId: number): Promise<PagoDto[]> {
    const rows: PaymentRow[] = await this.db.query(`${SELECT} WHERE p.ord_id = $1 ORDER BY p.pag_fecha DESC, p.pag_id DESC`, [ordId]);
    return rows.map(toDto);
  }

  async list(filters: { estado: EstadoPago | null; metodo: MetodoCodigo | null }, page: number, limit: number): Promise<{ total: number; items: PagoDto[] }> {
    const where = `WHERE ($1::varchar IS NULL OR e.est_codigo = $1) AND ($2::varchar IS NULL OR m.mpa_codigo = $2)`;
    const params = [filters.estado, filters.metodo];
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM pago p JOIN metodo_pago m ON m.mpa_id = p.mpa_id JOIN estado e ON e.est_id = p.est_id ${where}`,
      params,
    );
    const rows: PaymentRow[] = await this.db.query(`${SELECT} ${where} ORDER BY p.pag_fecha DESC, p.pag_id DESC LIMIT $3 OFFSET $4`, [...params, limit, (page - 1) * limit]);
    return { total, items: rows.map(toDto) };
  }

  /** `created = false` si el número ya existía: `pag_numero` es la clave de idempotencia. */
  async create(input: PagoInput): Promise<{ payment: PagoDto; created: boolean }> {
    try {
      return await this.db.transaction(async (m) => {
        const approved = input.canal === 'B2B';
        const inserted = await m.query(
          `INSERT INTO pago (pag_numero, ord_id, mpa_id, est_id, pag_monto, pag_aprobado_en)
           SELECT $1::varchar, $2::bigint, mpa_id, ${estado(approved ? 'APROBADO' : 'PENDIENTE')}, $3::numeric, ${approved ? 'now()' : 'NULL'}
           FROM metodo_pago WHERE mpa_codigo = $4 AND mpa_activo
           ON CONFLICT (pag_numero) DO NOTHING
           RETURNING pag_id`,
          [input.numero, input.ord_id, input.monto, input.metodo],
        );
        if (inserted.length === 0) {
          const existing = await this.findByNumberIn(input.numero, m);
          if (!existing) throw AppError.unprocessable('PAYMENT_METHOD_INACTIVE', `El método ${input.metodo} no está disponible.`);
          return { payment: existing, created: false };
        }
        const id = Number(inserted[0].pag_id);
        if (input.tarjeta) {
          const t = input.tarjeta;
          await m.query(
            `INSERT INTO pago_tarjeta (pag_id, pat_marca, pat_ultimos4, pat_titular, pat_mes, pat_anio, pat_pais) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, t.marca, t.ultimos4, t.titular, t.mes, t.anio, t.pais],
          );
        }
        const payment = (await this.findById(id, m)) as PagoDto;
        if (approved) await this.recordResult(payment, { aprobado: true, referencia: null, autorizacion: null }, m);
        return { payment, created: true };
      });
    } catch (error) {
      throw isApprovedConflict(error) ? alreadyApproved() : error;
    }
  }

  private async findByNumberIn(numero: string, m: EntityManager): Promise<PagoDto | null> {
    const [row] = await m.query(`${SELECT} WHERE p.pag_numero = $1`, [numero]);
    return row ? toDto(row) : null;
  }

  private recordResult(payment: PagoDto, result: PaymentResult, m: EntityManager): Promise<string> {
    const base = { pag_id: payment.id, numero: payment.numero, ord_id: payment.ord_id, metodo: payment.metodo, monto: payment.monto };
    return recordEvent(m, result.aprobado
      ? { tipoEvento: 'PagoAprobado', agregadoId: payment.numero, payload: { ...base, referencia: result.referencia, autorizacion: result.autorizacion } }
      : { tipoEvento: 'PagoRechazado', agregadoId: payment.numero, payload: { ...base, motivo: result.motivo } });
  }

  private async lock(id: number, m: EntityManager): Promise<PagoDto | null> {
    await m.query(`SELECT pag_id FROM pago WHERE pag_id = $1 FOR UPDATE`, [id]);
    return this.findById(id, m);
  }

  /**
   * Aplica el resultado una sola vez y publica su evento en la misma transacción. Devuelve el pago; con `applied = false`,
   * estaba en un estado final y no cambió.
   */
  async applyResult(id: number, result: PaymentResult): Promise<{ payment: PagoDto | null; applied: boolean }> {
    try {
      return await this.db.transaction(async (m) => {
        const current = await this.lock(id, m);
        if (!current || current.estado !== 'PENDIENTE') return { payment: current, applied: false };
        if (result.aprobado) {
          await m.query(
            `UPDATE pago SET est_id = ${estado('APROBADO')}, pag_aprobado_en = now(), pag_referencia = $2, pag_autorizacion = $3 WHERE pag_id = $1`,
            [id, result.referencia, result.autorizacion],
          );
        } else {
          await m.query(`UPDATE pago SET est_id = ${estado('RECHAZADO')}, pag_rechazado_en = now(), pag_motivo_rechazo = $2 WHERE pag_id = $1`, [id, result.motivo.slice(0, 300)]);
        }
        await this.recordResult(current, result, m);
        return { payment: await this.findById(id, m), applied: true };
      });
    } catch (error) {
      throw isApprovedConflict(error) ? alreadyApproved() : error;
    }
  }

  /** Un pago `PENDIENTE` pasa a `FALLIDO`. Repetirlo no cambia nada; uno aprobado se devuelve con Refund. */
  cancel(id: number): Promise<PagoDto | null> {
    return this.db.transaction(async (m) => {
      const current = await this.lock(id, m);
      if (!current) return null;
      if (current.estado === 'APROBADO') throw alreadyApproved();
      if (current.estado === 'PENDIENTE') await m.query(`UPDATE pago SET est_id = ${estado('FALLIDO')} WHERE pag_id = $1`, [id]);
      return this.findById(id, m);
    });
  }

  async markFailed(id: number): Promise<void> {
    await this.db.query(`UPDATE pago SET est_id = ${estado('FALLIDO')} WHERE pag_id = $1 AND est_id = ${estado('PENDIENTE')}`, [id]);
  }

  /** `false` si ya había comprobante. */
  async saveTransfer(id: number, input: TransferenciaInput): Promise<boolean> {
    const rows = await this.db.query(
      `INSERT INTO pago_transferencia (pag_id, ptr_banco, ptr_numero_comprobante, ptr_fecha_transferencia, ptr_archivo_adjunto)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT ON CONSTRAINT uq_pago_transferencia_pag_id DO NOTHING RETURNING ptr_id`,
      [id, input.banco, input.numero_comprobante, input.fecha_transferencia, input.archivo_adjunto],
    );
    return rows.length > 0;
  }

  async transferReceipt(id: number): Promise<string | null> {
    const [row] = await this.db.query(`SELECT ptr_numero_comprobante FROM pago_transferencia WHERE pag_id = $1`, [id]);
    return row?.ptr_numero_comprobante ?? null;
  }
}
