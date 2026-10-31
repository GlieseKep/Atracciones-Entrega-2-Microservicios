import { recordEvent, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { Buyer, FacturaDetalle, FacturaDto, FacturaLinea, IdType, InvoiceState, SriState } from '../contract';
import type { Breakdown } from '../application/tax';

interface InvoiceRow {
  fac_id: string;
  ord_id: string;
  dfa_id: string | null;
  fac_numero: string;
  fac_clave_acceso: string | null;
  fac_autorizacion_sri: string | null;
  fac_estado_sri: SriState;
  fac_mensaje_sri: string | null;
  fac_intentos: number;
  est_codigo: InvoiceState;
  fac_emitida_en: Date;
  fac_subtotal: string;
  fac_descuento: string;
  fac_iva: string;
  fac_total: string;
  fac_tipo_identificacion: IdType;
  fac_identificacion: string;
  fac_razon_social: string;
  fac_correo: string;
  fac_telefono: string | null;
}

interface LineRow {
  det_id: string;
  fde_codigo: string;
  fde_descripcion: string;
  fde_cantidad: number;
  fde_precio_unitario: string;
  fde_descuento: string;
  fde_subtotal: string;
  fde_iva_porcentaje: string;
  fde_iva: string;
  fde_total: string;
}

const SELECT = `SELECT f.fac_id, f.ord_id, f.dfa_id, f.fac_numero, f.fac_clave_acceso, f.fac_autorizacion_sri, f.fac_estado_sri, f.fac_mensaje_sri, f.fac_intentos,
    e.est_codigo, f.fac_emitida_en, f.fac_subtotal, f.fac_descuento, f.fac_iva, f.fac_total, f.fac_tipo_identificacion, f.fac_identificacion, f.fac_razon_social,
    f.fac_correo, f.fac_telefono
  FROM factura f JOIN estado e ON e.est_id = f.est_id`;

const toDto = (row: InvoiceRow): FacturaDto => ({
  id: Number(row.fac_id),
  ord_id: Number(row.ord_id),
  dfa_id: row.dfa_id === null ? null : Number(row.dfa_id),
  numero: row.fac_numero,
  clave_acceso: row.fac_clave_acceso,
  autorizacion_sri: row.fac_autorizacion_sri,
  estado: row.est_codigo,
  estado_sri: row.fac_estado_sri,
  mensaje_sri: row.fac_mensaje_sri,
  emitida_en: row.fac_emitida_en.toISOString(),
  subtotal: Number(row.fac_subtotal),
  descuento: Number(row.fac_descuento),
  iva: Number(row.fac_iva),
  total: Number(row.fac_total),
  tipo_identificacion: row.fac_tipo_identificacion,
  identificacion: row.fac_identificacion,
  razon_social: row.fac_razon_social,
  correo: row.fac_correo,
  telefono: row.fac_telefono,
});

const toLine = (row: LineRow): FacturaLinea => ({
  det_id: Number(row.det_id),
  codigo: row.fde_codigo,
  descripcion: row.fde_descripcion,
  cantidad: row.fde_cantidad,
  precio_unitario: Number(row.fde_precio_unitario),
  descuento: Number(row.fde_descuento),
  subtotal: Number(row.fde_subtotal),
  iva_porcentaje: Number(row.fde_iva_porcentaje),
  iva: Number(row.fde_iva),
  total: Number(row.fde_total),
});

export interface PendingInvoice {
  factura: FacturaDetalle;
  intentos: number;
}

export class InvoiceRepository {
  constructor(private readonly db: DataSource) {}

  async nextSequence(): Promise<number> {
    const [row] = await this.db.query(`SELECT nextval('seq_factura_secuencial') AS valor`);
    return Number(row.valor);
  }

  async existsForOrder(ordId: number): Promise<boolean> {
    const [row] = await this.db.query(`SELECT 1 FROM factura WHERE ord_id = $1`, [ordId]);
    return Boolean(row);
  }

  /** `false` si otro proceso ya facturó la orden: una factura por orden. */
  async create(ordId: number, numero: string, clave: string, buyer: Buyer, data: Breakdown): Promise<boolean> {
    try {
      await this.db.transaction(async (m) => {
        const [row] = await m.query(
          `INSERT INTO factura (ord_id, dfa_id, fac_numero, fac_clave_acceso, est_id, fac_subtotal, fac_descuento, fac_iva, fac_total, fac_tipo_identificacion,
             fac_identificacion, fac_razon_social, fac_correo, fac_telefono)
           VALUES ($1, $2, $3, $4, (SELECT est_id FROM estado WHERE est_codigo = 'PAGADA'), $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING fac_id`,
          [ordId, buyer.dfaId, numero, clave, data.subtotal, data.descuento, data.iva, data.total, buyer.tipo, buyer.identificacion, buyer.razonSocial, buyer.correo, buyer.telefono],
        );
        for (const line of data.lines) {
          await m.query(
            `INSERT INTO factura_detalle (fac_id, det_id, fde_codigo, fde_descripcion, fde_cantidad, fde_precio_unitario, fde_descuento, fde_subtotal, fde_iva_porcentaje, fde_iva, fde_total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [row.fac_id, line.det_id, line.codigo, line.descripcion, line.cantidad, line.precio_unitario, line.descuento, line.subtotal, line.iva_porcentaje, line.iva, line.total],
          );
        }
      });
      return true;
    } catch (error) {
      const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
      if (driver?.code === '23505' && driver.constraint === 'uq_factura_orden') return false;
      throw error;
    }
  }

  private async withLines(row: InvoiceRow, db: DataSource | EntityManager = this.db): Promise<FacturaDetalle> {
    const lines: LineRow[] = await db.query(
      `SELECT det_id, fde_codigo, fde_descripcion, fde_cantidad, fde_precio_unitario, fde_descuento, fde_subtotal, fde_iva_porcentaje, fde_iva, fde_total
       FROM factura_detalle WHERE fac_id = $1 ORDER BY fde_id`,
      [row.fac_id],
    );
    return { ...toDto(row), detalle: lines.map(toLine) };
  }

  async findById(id: number): Promise<FacturaDetalle | null> {
    const [row] = await this.db.query(`${SELECT} WHERE f.fac_id = $1`, [id]);
    return row ? this.withLines(row) : null;
  }

  async findByOrder(ordId: number): Promise<FacturaDetalle | null> {
    const [row] = await this.db.query(`${SELECT} WHERE f.ord_id = $1`, [ordId]);
    return row ? this.withLines(row) : null;
  }

  async list(estado: string | null, estadoSri: string | null, page: number, limit: number): Promise<{ total: number; items: FacturaDto[] }> {
    const where = `WHERE ($1::varchar IS NULL OR e.est_codigo = $1) AND ($2::varchar IS NULL OR f.fac_estado_sri = $2)`;
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM factura f JOIN estado e ON e.est_id = f.est_id ${where}`, [estado, estadoSri]);
    const rows: InvoiceRow[] = await this.db.query(`${SELECT} ${where} ORDER BY f.fac_emitida_en DESC, f.fac_id DESC LIMIT $3 OFFSET $4`, [estado, estadoSri, limit, (page - 1) * limit]);
    return { total, items: rows.map(toDto) };
  }

  /** Toma una factura lista para enviar. `SKIP LOCKED`: varios workers no envían la misma. */
  async takeNext(m: EntityManager): Promise<PendingInvoice | null> {
    const [row] = await m.query(
      `${SELECT} WHERE f.fac_estado_sri = 'PENDIENTE' AND f.fac_proximo_intento_en <= now() ORDER BY f.fac_proximo_intento_en, f.fac_id LIMIT 1 FOR UPDATE OF f SKIP LOCKED`,
    );
    return row ? { factura: await this.withLines(row, m), intentos: row.fac_intentos } : null;
  }

  /** `AUTORIZADA` y `FacturaAutorizada` en la misma transacción. */
  async markAuthorized(factura: FacturaDetalle, autorizacion: string, m: EntityManager): Promise<void> {
    await m.query(`UPDATE factura SET fac_estado_sri = 'AUTORIZADA', fac_autorizacion_sri = $2, fac_mensaje_sri = NULL WHERE fac_id = $1`, [factura.id, autorizacion]);
    await recordEvent(m, {
      tipoEvento: 'FacturaAutorizada',
      agregadoId: factura.numero,
      payload: { fac_id: factura.id, ord_id: factura.ord_id, numero: factura.numero, clave_acceso: factura.clave_acceso, autorizacion_sri: autorizacion, total: factura.total },
    });
  }

  async markRejected(id: number, mensaje: string, m: EntityManager): Promise<void> {
    await m.query(`UPDATE factura SET fac_estado_sri = 'RECHAZADA', fac_mensaje_sri = $2 WHERE fac_id = $1`, [id, mensaje.slice(0, 500)]);
  }

  async scheduleRetry(id: number, intentos: number, minutos: number, mensaje: string, m: EntityManager): Promise<void> {
    await m.query(
      `UPDATE factura SET fac_intentos = $2, fac_proximo_intento_en = now() + make_interval(mins => $3), fac_mensaje_sri = $4 WHERE fac_id = $1`,
      [id, intentos, minutos, mensaje.slice(0, 500)],
    );
  }

  /** `PAGADA` → `ANULADA` cuando lo devuelto iguala el total. Un reembolso parcial no la cambia. */
  async annulIfRefunded(ordId: number, acumulado: number): Promise<boolean> {
    const rows = returnedRows(
      await this.db.query(
        `UPDATE factura SET est_id = (SELECT est_id FROM estado WHERE est_codigo = 'ANULADA')
         WHERE ord_id = $1 AND $2::numeric >= fac_total AND est_id = (SELECT est_id FROM estado WHERE est_codigo = 'PAGADA') RETURNING fac_id`,
        [ordId, acumulado],
      ),
    );
    return rows.length > 0;
  }
}
