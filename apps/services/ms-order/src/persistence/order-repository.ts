import { randomInt } from 'node:crypto';
import { AppError, recordEvent, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { CART_SYNC_EVENT, TICKET_TYPES, type CartSyncPayload, type OrderDetail, type OrderLine, type OrderOwner, type OrderState, type OrderSummary, type TicketType } from '../contract';
import type { Totals } from '../application/totals';

export interface OrderRow {
  ord_id: string;
  ord_numero: string;
  usu_id: string | null;
  cla_id: string | null;
  cai_id: string | null;
  mpa_id: number | null;
  est_codigo: OrderState;
  ord_fecha: Date;
  ord_subtotal: string;
  ord_descuento: string;
  ord_iva: string;
  ord_total: string;
  ord_moneda: string;
}

interface LineRow {
  det_id: string;
  ord_id: string;
  atr_id: string;
  det_descripcion: string;
  det_cantidad: number;
  det_precio_unitario: string;
  det_subtotal: string;
}

const SELECT = `SELECT o.ord_id, o.ord_numero, o.usu_id, o.cla_id, o.cai_id, o.mpa_id, e.est_codigo, o.ord_fecha, o.ord_subtotal, o.ord_descuento,
    o.ord_iva, o.ord_total, o.ord_moneda
  FROM orden o JOIN estado e ON e.est_id = o.est_id`;

const estado = (codigo: OrderState) => `(SELECT est_id FROM estado WHERE est_codigo = '${codigo}')`;

/** `orden_detalle` no tiene columna de tipo de boleto: va en el snapshot del nombre, como `Tour Quito (ADULT)`. */
const describe = (nombre: string, tipo: TicketType) => `${nombre.slice(0, 240)} (${tipo})`;
const TYPE_IN_DESCRIPTION = new RegExp(`\\((${TICKET_TYPES.join('|')})\\)$`);
const typeOf = (descripcion: string) => (TYPE_IN_DESCRIPTION.exec(descripcion)?.[1] ?? 'ADULT') as TicketType;

const toLine = (row: LineRow): OrderLine => ({
  det_id: Number(row.det_id),
  atr_id: Number(row.atr_id),
  descripcion: row.det_descripcion,
  ticket_type: typeOf(row.det_descripcion),
  cantidad: row.det_cantidad,
  precio_unitario: Number(row.det_precio_unitario),
  subtotal: Number(row.det_subtotal),
});

function toSummary(row: OrderRow, lines: OrderLine[]): OrderSummary {
  // Booking apunta a la línea de adultos, que siempre existe en una compra normal.
  const adult = lines.find((line) => line.ticket_type === 'ADULT') ?? lines[0];
  return {
    ord_id: Number(row.ord_id),
    ord_numero: row.ord_numero,
    det_id_adulto: adult?.det_id ?? 0,
    estado: row.est_codigo,
    subtotal: Number(row.ord_subtotal),
    descuento: Number(row.ord_descuento),
    iva: Number(row.ord_iva),
    total: Number(row.ord_total),
    moneda: row.ord_moneda,
  };
}

const newOrderNumber = () => `ORD-DILAN-${Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('')}`;

export interface NewOrder {
  owner: OrderOwner;
  caiId: number | null;
  mpaId: number;
  atrId: number;
  nombre: string;
  moneda: string;
  observaciones: string | null;
  totals: Totals;
  lines: { type: TicketType; cantidad: number; unitPrice: number; subtotal: number }[];
  coupon: { cupId: number; maxUses: number | null } | null;
}

export class OrderRepository {
  constructor(private readonly db: DataSource) {}

  private async linesOf(ids: string[], db: DataSource | EntityManager = this.db): Promise<LineRow[]> {
    return db.query(`SELECT det_id, ord_id, atr_id, det_descripcion, det_cantidad, det_precio_unitario, det_subtotal FROM orden_detalle WHERE ord_id = ANY($1::bigint[]) ORDER BY det_id`, [ids]);
  }

  async findByNumber(numero: string): Promise<OrderRow | null> {
    const [row] = await this.db.query(`${SELECT} WHERE o.ord_numero = $1`, [numero]);
    return row ?? null;
  }

  async findById(id: number): Promise<OrderRow | null> {
    const [row] = await this.db.query(`${SELECT} WHERE o.ord_id = $1`, [id]);
    return row ?? null;
  }

  async summary(row: OrderRow): Promise<OrderSummary> {
    return toSummary(row, (await this.linesOf([row.ord_id])).map(toLine));
  }

  async detail(row: OrderRow, metodo: string): Promise<OrderDetail> {
    const lineas = (await this.linesOf([row.ord_id])).map(toLine);
    return {
      orden: toSummary(row, lineas),
      usu_id: Number(row.usu_id ?? 0),
      cla_id: Number(row.cla_id ?? 0),
      metodo,
      lineas,
      fecha: row.ord_fecha.toISOString(),
    };
  }

  async list(owner: OrderOwner | null, estadoFiltro: string | null, page: number, limit: number): Promise<{ total: number; items: OrderSummary[] }> {
    const where = `WHERE ($1::bigint IS NULL OR o.usu_id = $1) AND ($2::bigint IS NULL OR o.cla_id = $2) AND ($3::varchar IS NULL OR e.est_codigo = $3)`;
    const params = [owner?.usuId ?? null, owner?.claId ?? null, estadoFiltro];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM orden o JOIN estado e ON e.est_id = o.est_id ${where}`, params);
    const rows: OrderRow[] = await this.db.query(`${SELECT} ${where} ORDER BY o.ord_fecha DESC, o.ord_id DESC LIMIT $4 OFFSET $5`, [...params, limit, (page - 1) * limit]);
    const lines = rows.length > 0 ? await this.linesOf(rows.map((row) => row.ord_id)) : [];
    return { total, items: rows.map((row) => toSummary(row, lines.filter((line) => line.ord_id === row.ord_id).map(toLine))) };
  }

  /** Orden, líneas, cupón y `OrdenCreada` en una transacción. El límite del cupón se cuenta bajo un bloqueo por `cup_id`. */
  async create(order: NewOrder): Promise<OrderRow> {
    try {
      const ordId = await this.db.transaction(async (m) => {
        if (order.coupon?.maxUses !== null && order.coupon?.maxUses !== undefined) await this.assertCouponAvailable(order.coupon.cupId, order.coupon.maxUses, m);
        const [row] = await m.query(
          `INSERT INTO orden (ord_numero, usu_id, cla_id, cai_id, est_id, mpa_id, ord_subtotal, ord_descuento, ord_iva, ord_total, ord_moneda, ord_observaciones)
           VALUES ($1, $2, $3, $4, ${estado('CREADA')}, $5, $6, $7, $8, $9, $10, $11) RETURNING ord_id, ord_numero`,
          [newOrderNumber(), order.owner.usuId, order.owner.claId, order.caiId, order.mpaId, order.totals.subtotal, order.totals.descuento, order.totals.iva, order.totals.total, order.moneda, order.observaciones],
        );
        for (const line of order.lines) {
          await m.query(
            `INSERT INTO orden_detalle (ord_id, atr_id, det_descripcion, det_cantidad, det_precio_unitario, det_subtotal) VALUES ($1, $2, $3, $4, $5, $6)`,
            [row.ord_id, order.atrId, describe(order.nombre, line.type), line.cantidad, line.unitPrice, line.subtotal],
          );
        }
        if (order.coupon) await m.query(`INSERT INTO orden_cupon (ord_id, cup_id) VALUES ($1, $2)`, [row.ord_id, order.coupon.cupId]);
        await recordEvent(m, {
          tipoEvento: 'OrdenCreada',
          agregadoId: row.ord_numero,
          payload: { ord_id: Number(row.ord_id), ord_numero: row.ord_numero, usu_id: order.owner.usuId, cla_id: order.owner.claId, total: order.totals.total, moneda: order.moneda },
        });
        return Number(row.ord_id);
      });
      return (await this.findById(ordId)) as OrderRow;
    } catch (error) {
      const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
      if (driver?.code === '23505' && driver.constraint === 'uq_orden_cai_id') throw AppError.conflict('CART_ITEM_ALREADY_ORDERED', 'El ítem ya está en otra orden.');
      throw error;
    }
  }

  /** Las órdenes `CANCELADA` no cuentan. */
  private async assertCouponAvailable(cupId: number, maxUses: number, m: EntityManager): Promise<void> {
    await m.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [cupId]);
    const [{ usos }] = await m.query(
      `SELECT count(*)::int AS usos FROM orden_cupon c JOIN orden o ON o.ord_id = c.ord_id JOIN estado e ON e.est_id = o.est_id
       WHERE c.cup_id = $1 AND e.est_codigo <> 'CANCELADA'`,
      [cupId],
    );
    if (usos >= maxUses) throw AppError.unprocessable('COUPON_EXHAUSTED', 'El cupón ya alcanzó su límite de usos.', [{ name: 'coupon_code', reason: 'Sin usos disponibles.' }]);
  }

  private async recordCartSync(m: EntityManager, payload: CartSyncPayload): Promise<void> {
    await recordEvent(m, { tipoEvento: CART_SYNC_EVENT, agregadoId: payload.ord_numero, payload: { ...payload } });
  }

  /** `CREADA` → `PAGADA`, con `OrdenPagada` en la misma transacción. Un evento repetido no cambia nada. */
  markPaid(ordId: number): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const rows = returnedRows<OrderRow>(
        await m.query(
          `UPDATE orden SET est_id = ${estado('PAGADA')} WHERE ord_id = $1 AND est_id = ${estado('CREADA')}
           RETURNING ord_id, ord_numero, usu_id, cla_id, cai_id, ord_subtotal, ord_descuento, ord_iva, ord_total, ord_moneda`,
          [ordId],
        ),
      );
      if (rows.length === 0) return false;
      const [row] = rows;
      await recordEvent(m, {
        tipoEvento: 'OrdenPagada',
        agregadoId: row.ord_numero,
        payload: {
          ord_id: Number(row.ord_id),
          ord_numero: row.ord_numero,
          usu_id: row.usu_id === null ? null : Number(row.usu_id),
          cla_id: row.cla_id === null ? null : Number(row.cla_id),
          subtotal: Number(row.ord_subtotal),
          descuento: Number(row.ord_descuento),
          iva: Number(row.ord_iva),
          total: Number(row.ord_total),
          moneda: row.ord_moneda,
        },
      });
      if (row.cai_id !== null) await this.recordCartSync(m, { accion: 'confirmar', cai_id: Number(row.cai_id), ord_numero: row.ord_numero });
      return true;
    });
  }

  /** `CREADA` → `CANCELADA`. Deja `cai_id` en `NULL`, para que el ítem se pueda volver a comprar, y avisa a Cart. */
  cancel(ordId: number): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const [current] = await m.query(`SELECT cai_id, ord_numero FROM orden WHERE ord_id = $1 FOR UPDATE`, [ordId]);
      const rows = returnedRows(await m.query(`UPDATE orden SET est_id = ${estado('CANCELADA')}, cai_id = NULL WHERE ord_id = $1 AND est_id = ${estado('CREADA')} RETURNING ord_id`, [ordId]));
      if (rows.length === 0) return false;
      if (current.cai_id !== null) await this.recordCartSync(m, { accion: 'liberar', cai_id: Number(current.cai_id), ord_numero: current.ord_numero });
      return true;
    });
  }

  /** `true` si pasó a `REEMBOLSADA`. Solo cuando el total devuelto iguala `ord_total`. */
  async markRefunded(ordId: number, acumulado: number): Promise<boolean> {
    const rows = returnedRows(
      await this.db.query(
        `UPDATE orden SET est_id = ${estado('REEMBOLSADA')} WHERE ord_id = $1 AND est_id = ${estado('PAGADA')} AND $2::numeric >= ord_total RETURNING ord_id`,
        [ordId, acumulado],
      ),
    );
    return rows.length > 0;
  }

  /** Órdenes `CREADA` antiguas. */
  async staleOrders(minutes: number): Promise<number[]> {
    const rows: { ord_id: string }[] = await this.db.query(
      `SELECT ord_id FROM orden WHERE est_id = ${estado('CREADA')} AND ord_creado_en < now() - make_interval(mins => $1) ORDER BY ord_id LIMIT 100`,
      [minutes],
    );
    return rows.map((row) => Number(row.ord_id));
  }
}
