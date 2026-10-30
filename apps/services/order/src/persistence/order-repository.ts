import { randomBytes } from 'node:crypto';
import { currentCorrelationId, newCorrelationId, recordEvent } from '@atracciones/platform';
import type { DataSource } from 'typeorm';

export type EstadoSaga = 'INICIADA' | 'CUPOS_RESERVADOS' | 'PAGO_REGISTRADO' | 'RESERVA_EMITIDA' | 'COMPLETADA' | 'COMPENSANDO' | 'COMPENSADA';
export type Paso = 'RESERVAR_CUPOS' | 'REGISTRAR_PAGO' | 'EMITIR_RESERVA';

export interface NewOrder {
  id: string;
  codigoExterno: string;
  principalTipo: string;
  principalId: string;
  sagaId: string | null;
  nodeId: string | null;
  metodoPago: string;
  moneda: string;
  atraccionCodigo: string;
  fecha: string;
  hora: string;
  boletos: { tipo: string; cantidad: number; precio: number }[];
}

export interface OrderRow {
  id: string;
  codigo_externo: string;
  estado: string;
  estado_saga: EstadoSaga;
  metodo_pago: string;
  total: number;
}

/** Orden con su total y su (único) turno, como la muestran el portal y la administración. */
export interface OrderSummaryRow {
  id: string;
  external_order_id: string;
  estado: string;
  estado_saga: string;
  metodo_pago: string;
  total: number;
  moneda: string;
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  boletos: number;
  principal_tipo: string;
  principal_id: string;
  creado_en: string;
  actualizado_en: string;
  correlation_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUMMARY = `
  SELECT o.id, o.codigo_externo AS external_order_id, o.estado, o.estado_saga, o.metodo_pago, t.total, o.moneda,
         coalesce(trim(d.atraccion_codigo), '') AS atraccion_codigo, coalesce(d.fecha::text, '') AS fecha, coalesce(d.hora::text, '') AS hora,
         coalesce((SELECT sum(b.cantidad) FROM orden_detalle_boleto b JOIN orden_detalle x ON x.id = b.orden_detalle_id WHERE x.orden_id = o.id), 0)::int AS boletos,
         o.principal_tipo, o.principal_id, o.creado_en, o.actualizado_en, o.correlation_id
    FROM orden o
    JOIN v_orden_total t ON t.orden_id = o.id
    LEFT JOIN LATERAL (SELECT atraccion_codigo, fecha, hora FROM orden_detalle WHERE orden_id = o.id ORDER BY fecha, hora LIMIT 1) d ON true`;

const toSummary = (r: Record<string, unknown>): OrderSummaryRow => ({
  ...(r as unknown as OrderSummaryRow),
  total: Number(r.total),
  creado_en: new Date(r.creado_en as string).toISOString(),
  actualizado_en: new Date(r.actualizado_en as string).toISOString(),
});

const BASE36 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** `external_order_id` del contrato: `ORD-` + 10 caracteres aleatorios. */
export const newExternalOrderId = () => `ORD-${Array.from(randomBytes(10), (b) => BASE36[b % 36]).join('')}`;

export class OrderRepository {
  constructor(private readonly db: DataSource) {}

  /** Registra la orden pendiente con su detalle y precios, y el evento `OrdenCreada`. */
  async insert(order: NewOrder): Promise<void> {
    await this.db.transaction(async (m) => {
      await m.query(
        `INSERT INTO orden (id, codigo_externo, principal_tipo, principal_id, saga_id, node_id, metodo_pago, moneda, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [order.id, order.codigoExterno, order.principalTipo, order.principalId, order.sagaId, order.nodeId, order.metodoPago, order.moneda,
          currentCorrelationId() ?? newCorrelationId()],
      );
      const [detalle] = await m.query(
        `INSERT INTO orden_detalle (orden_id, atraccion_codigo, fecha, hora) VALUES ($1, $2, $3, $4) RETURNING id`,
        [order.id, order.atraccionCodigo, order.fecha, order.hora],
      );
      for (const b of order.boletos) {
        await m.query(
          `INSERT INTO orden_detalle_boleto (orden_detalle_id, tipo_boleto, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)`,
          [detalle.id, b.tipo, b.cantidad, b.precio],
        );
      }
      await recordEvent(m, {
        tipoEvento: 'OrdenCreada',
        agregadoId: order.codigoExterno,
        payload: { orden_id: order.id, external_order_id: order.codigoExterno, atraccion_codigo: order.atraccionCodigo, fecha: order.fecha, hora: order.hora },
      });
    });
  }

  async setSaga(id: string, estadoSaga: EstadoSaga, estado?: 'PENDIENTE' | 'CONFIRMADA' | 'CANCELADA' | 'FALLIDA'): Promise<void> {
    await this.db.query(
      `UPDATE orden SET estado_saga = $2, estado = coalesce($3, estado), actualizado_en = now(), version = version + 1 WHERE id = $1`,
      [id, estadoSaga, estado ?? null],
    );
  }

  async recordStep(ordenId: string, paso: Paso, accion: 'EJECUTAR' | 'COMPENSAR', resultado: 'OK' | 'ERROR', detalle: string | null = null): Promise<void> {
    await this.db.query(
      `INSERT INTO orden_paso_saga (orden_id, paso, accion, resultado, detalle) VALUES ($1, $2, $3, $4, $5)`,
      [ordenId, paso, accion, resultado, detalle?.slice(0, 500) ?? null],
    );
  }

  /** Pasos ejecutados con éxito y todavía no compensados, del último al primero (orden LIFO de compensación). */
  async pendingCompensations(ordenId: string): Promise<Paso[]> {
    const rows: { paso: Paso }[] = await this.db.query(
      `SELECT paso FROM orden_paso_saga e
        WHERE e.orden_id = $1 AND e.accion = 'EJECUTAR' AND e.resultado = 'OK'
          AND NOT EXISTS (SELECT 1 FROM orden_paso_saga c WHERE c.orden_id = e.orden_id AND c.paso = e.paso AND c.accion = 'COMPENSAR' AND c.resultado = 'OK')
        ORDER BY e.id DESC`,
      [ordenId],
    );
    return rows.map((r) => r.paso);
  }

  /** Confirma la orden: estado CONFIRMADA, saga COMPLETADA y evento `OrdenConfirmada` (lo consume Invoicing). */
  async confirm(ordenId: string, reservationCode: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const [row] = await m.query(
        `UPDATE orden SET estado = 'CONFIRMADA', estado_saga = 'COMPLETADA', actualizado_en = now(), version = version + 1
          WHERE id = $1 RETURNING codigo_externo, metodo_pago, moneda`,
        [ordenId],
      ).then((r: unknown[]) => (r[0] as Record<string, string>[]) ?? []);
      const [total] = await m.query(`SELECT total FROM v_orden_total WHERE orden_id = $1`, [ordenId]);
      const lineas: { atraccion_codigo: string; fecha: string; hora: string; tipo_boleto: string; cantidad: number; precio_unitario: string }[] = await m.query(
        `SELECT d.atraccion_codigo, d.fecha::text AS fecha, d.hora::text AS hora, b.tipo_boleto, b.cantidad, b.precio_unitario
           FROM orden_detalle d JOIN orden_detalle_boleto b ON b.orden_detalle_id = d.id WHERE d.orden_id = $1 ORDER BY b.tipo_boleto`,
        [ordenId],
      );
      // Las líneas (sin datos personales) son las que Invoicing factura.
      await recordEvent(m, {
        tipoEvento: 'OrdenConfirmada',
        agregadoId: row.codigo_externo,
        payload: {
          orden_id: ordenId, external_order_id: row.codigo_externo, reservation_code: reservationCode, metodo_pago: row.metodo_pago, moneda: row.moneda,
          total: Number(total.total),
          lineas: lineas.map((l) => ({ ...l, cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario) })),
        },
      });
    });
  }

  /** Marca la orden como fallida o cancelada tras compensar, con su evento. */
  async close(ordenId: string, estado: 'FALLIDA' | 'CANCELADA', estadoSaga: EstadoSaga): Promise<void> {
    await this.db.transaction(async (m) => {
      const [row] = await m.query(
        `UPDATE orden SET estado = $2, estado_saga = $3, actualizado_en = now(), version = version + 1 WHERE id = $1 RETURNING codigo_externo`,
        [ordenId, estado, estadoSaga],
      ).then((r: unknown[]) => (r[0] as Record<string, string>[]) ?? []);
      if (row && estado === 'CANCELADA') {
        await recordEvent(m, { tipoEvento: 'OrdenCancelada', agregadoId: row.codigo_externo, payload: { orden_id: ordenId, external_order_id: row.codigo_externo } });
      }
    });
  }

  async findByExternalId(codigoExterno: string): Promise<OrderRow | null> {
    const [row] = await this.db.query(
      `SELECT o.id, o.codigo_externo, o.estado, o.estado_saga, o.metodo_pago, t.total
         FROM orden o JOIN v_orden_total t ON t.orden_id = o.id WHERE o.codigo_externo = $1`,
      [codigoExterno],
    );
    return row ? { ...row, total: Number(row.total) } : null;
  }

  /** Resumen por uuid o `external_order_id`. */
  async summary(id: string): Promise<OrderSummaryRow | null> {
    const [row] = await this.db.query(`${SUMMARY} WHERE ${UUID.test(id) ? 'o.id = $1::uuid' : 'o.codigo_externo = $1'}`, [id]);
    return row ? toSummary(row) : null;
  }

  async lines(ordenId: string) {
    const rows: { atraccion_codigo: string; fecha: string; hora: string; boletos: { ticket_type: string; cantidad: number; precio_unitario: string }[] }[] = await this.db.query(
      `SELECT trim(d.atraccion_codigo) AS atraccion_codigo, d.fecha::text AS fecha, d.hora::text AS hora,
              json_agg(json_build_object('ticket_type', b.tipo_boleto, 'cantidad', b.cantidad, 'precio_unitario', b.precio_unitario) ORDER BY b.tipo_boleto) AS boletos
         FROM orden_detalle d JOIN orden_detalle_boleto b ON b.orden_detalle_id = d.id WHERE d.orden_id = $1 GROUP BY d.id ORDER BY d.fecha, d.hora`,
      [ordenId],
    );
    return rows.map((r) => ({ ...r, boletos: r.boletos.map((b) => ({ ...b, cantidad: Number(b.cantidad), precio_unitario: Number(b.precio_unitario) })) }));
  }

  async steps(ordenId: string) {
    const rows: { paso: string; accion: string; resultado: string; detalle: string | null; creado_en: Date }[] = await this.db.query(
      `SELECT paso, accion, resultado, detalle, creado_en FROM orden_paso_saga WHERE orden_id = $1 ORDER BY id`,
      [ordenId],
    );
    return rows.map((r) => ({ ...r, detalle: r.detalle ?? '', creado_en: r.creado_en.toISOString() }));
  }

  async list(filters: { principal: { tipo: string; id: string } | null; estado: string | null; desde: string | null; hasta: string | null; search: string | null; metodo: string | null; timeZone: string; limit: number; offset: number }) {
    const params: unknown[] = [];
    const add = (v: unknown) => `$${params.push(v)}`;
    const where: string[] = ['true'];
    if (filters.principal) where.push(`o.principal_tipo = ${add(filters.principal.tipo)} AND o.principal_id = ${add(filters.principal.id)}::uuid`);
    if (filters.estado) where.push(`o.estado = ${add(filters.estado)}`);
    if (filters.metodo) where.push(`o.metodo_pago = ${add(filters.metodo)}`);
    if (filters.search) where.push(`o.codigo_externo = upper(${add(filters.search)})`);
    if (filters.desde || filters.hasta) {
      const tz = add(filters.timeZone);
      if (filters.desde) where.push(`(o.creado_en AT TIME ZONE ${tz})::date >= ${add(filters.desde)}::date`);
      if (filters.hasta) where.push(`(o.creado_en AT TIME ZONE ${tz})::date <= ${add(filters.hasta)}::date`);
    }
    const condition = where.join(' AND ');
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM orden o WHERE ${condition}`, params);
    const rows = await this.db.query(`${SUMMARY} WHERE ${condition} ORDER BY o.creado_en DESC, o.id LIMIT ${add(filters.limit)} OFFSET ${add(filters.offset)}`, params);
    return { total, items: rows.map(toSummary) };
  }

  /** Ingresos de las órdenes confirmadas (las canceladas ya se reembolsaron) y totales por estado, por fecha de compra. */
  async salesReport(desde: string, hasta: string, timeZone: string) {
    const params = [desde, hasta, timeZone];
    const range = `(o.creado_en AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`;
    const lines = `FROM orden o JOIN orden_detalle d ON d.orden_id = o.id JOIN orden_detalle_boleto b ON b.orden_detalle_id = d.id
                   WHERE ${range} AND o.estado = 'CONFIRMADA'`;
    const [porAtraccion, porDia, porMetodo, porEstado] = await Promise.all([
      this.db.query(
        `SELECT trim(d.atraccion_codigo) AS atraccion_codigo, count(DISTINCT o.id)::int AS ordenes, sum(b.cantidad)::int AS boletos, sum(b.cantidad * b.precio_unitario)::float AS ingresos
           ${lines} GROUP BY d.atraccion_codigo ORDER BY ingresos DESC`,
        params,
      ),
      this.db.query(
        `SELECT ((o.creado_en AT TIME ZONE $3)::date)::text AS fecha, count(DISTINCT o.id)::int AS ordenes, sum(b.cantidad)::int AS boletos, sum(b.cantidad * b.precio_unitario)::float AS ingresos
           ${lines} GROUP BY 1 ORDER BY 1`,
        params,
      ),
      this.db.query(
        `SELECT o.metodo_pago, count(*)::int AS ordenes, sum(t.total)::float AS ingresos
           FROM orden o JOIN v_orden_total t ON t.orden_id = o.id WHERE ${range} AND o.estado = 'CONFIRMADA' GROUP BY o.metodo_pago ORDER BY ingresos DESC`,
        params,
      ),
      this.db.query(
        `SELECT o.estado, count(*)::int AS ordenes, coalesce(sum(t.total), 0)::float AS monto
           FROM orden o JOIN v_orden_total t ON t.orden_id = o.id WHERE ${range} GROUP BY o.estado ORDER BY o.estado`,
        params,
      ),
    ]);
    const ingresos = Math.round(porMetodo.reduce((s: number, m: { ingresos: number }) => s + m.ingresos, 0) * 100) / 100;
    return {
      moneda: 'USD',
      ingresos,
      ordenes: porMetodo.reduce((s: number, m: { ordenes: number }) => s + m.ordenes, 0),
      por_atraccion: porAtraccion,
      por_dia: porDia,
      por_metodo: porMetodo,
      por_estado: porEstado,
    };
  }

  /** Sagas sin terminar que llevan más del plazo indicado sin avanzar (el proceso que las atendía cayó). */
  async stuckSagas(olderThanSeconds: number): Promise<{ id: string; codigo_externo: string; estado: string }[]> {
    return this.db.query(
      `SELECT id, codigo_externo, estado FROM orden
        WHERE estado_saga NOT IN ('COMPLETADA', 'COMPENSADA') AND actualizado_en < now() - make_interval(secs => $1)
        ORDER BY actualizado_en LIMIT 50`,
      [olderThanSeconds],
    );
  }
}
