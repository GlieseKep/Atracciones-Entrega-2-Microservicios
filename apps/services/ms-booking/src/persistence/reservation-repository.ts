import { randomInt } from 'node:crypto';
import { returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { CustomerInput, EventType, ReservationState } from '../contract';
import type { EventRepository } from './event-repository';

export interface ReservationRow {
  res_id: string;
  res_uuid: string;
  res_codigo: string;
  ord_numero: string;
  det_id: string;
  dis_id: string;
  gui_id: string | null;
  est_codigo: ReservationState;
  res_adultos: number;
  res_ninos: number;
  res_seniors: number;
  res_estudiantes: number;
  res_infantes: number;
  res_numero_tickets: number;
  res_precio_total: string;
  res_voucher_qr: string | null;
  res_reembolso_id: string | null;
  res_monto_reembolsado: string | null;
  res_checkin_en: Date | null;
  res_creado_en: Date;
  /** Turista de `cliente_api` (Identity); `null` en compras web. */
  cla_id_cliente: string | null;
  res_canal: 'WEB' | 'SOCIO';
  /** Aviso del check-in a Booking Central (`null` si no hay aviso). */
  nch_enviado_en: Date | null;
  nch_intentos: number | null;
  pax_nombre: string;
  pax_tipo_documento: string;
  pax_documento: string;
  pax_correo: string;
  pax_telefono: string;
}

const SELECT = `SELECT r.res_id, r.res_uuid, r.res_codigo, r.ord_numero, r.det_id, r.dis_id, r.gui_id, e.est_codigo, r.res_adultos, r.res_ninos, r.res_seniors,
    r.res_estudiantes, r.res_infantes, r.res_numero_tickets, r.res_precio_total, r.res_voucher_qr, r.res_reembolso_id, r.res_monto_reembolsado,
    r.res_checkin_en, r.res_creado_en, p.pax_nombre, p.pax_tipo_documento, p.pax_documento, p.pax_correo, p.pax_telefono,
    r.cla_id_cliente, r.res_canal, n.nch_enviado_en, n.nch_intentos
  FROM reserva r
  JOIN estado e ON e.est_id = r.est_id
  JOIN reserva_pasajero p ON p.res_id = r.res_id AND p.pax_es_titular
  LEFT JOIN notificacion_checkin n ON n.res_id = r.res_id`;

const estado = (codigo: ReservationState) => `(SELECT est_id FROM estado WHERE est_codigo = '${codigo}')`;

export const newReservationCode = () => `DEC-${Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('')}`;

export interface NewReservation {
  uuid: string;
  codigo: string;
  ordNumero: string;
  detId: number;
  disId: number;
  guiId: number | null;
  sagaId: string | null;
  adultos: number;
  ninos: number;
  seniors: number;
  infantes: number;
  total: number;
  requerimientos: string | null;
  voucher: string;
  customer: CustomerInput;
  claIdCliente: number | null;
  canal: 'WEB' | 'SOCIO';
}

export interface OutgoingEvent {
  tipo: EventType;
  payload: Record<string, unknown>;
}

export class ReservationRepository {
  constructor(
    private readonly db: DataSource,
    private readonly events: EventRepository,
  ) {}

  /** Por UUID o PNR. */
  async find(id: string, db: DataSource | EntityManager = this.db): Promise<ReservationRow | null> {
    const [row] = await db.query(`${SELECT} WHERE r.res_uuid::text = lower($1) OR r.res_codigo = upper($1)`, [id]);
    return row ?? null;
  }

  async findByOrder(ordNumero: string): Promise<ReservationRow | null> {
    const [row] = await this.db.query(`${SELECT} WHERE r.ord_numero = $1`, [ordNumero]);
    return row ?? null;
  }

  async listByOrders(numeros: string[]): Promise<ReservationRow[]> {
    return this.db.query(`${SELECT} WHERE r.ord_numero = ANY($1::varchar[]) ORDER BY r.res_creado_en DESC`, [numeros]);
  }

  async list(estadoFiltro: string | null, page: number, limit: number): Promise<{ total: number; rows: ReservationRow[] }> {
    const where = `WHERE ($1::varchar IS NULL OR e.est_codigo = $1)`;
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM reserva r JOIN estado e ON e.est_id = r.est_id ${where}`, [estadoFiltro]);
    const rows = await this.db.query(`${SELECT} ${where} ORDER BY r.res_creado_en DESC, r.res_id DESC LIMIT $2 OFFSET $3`, [estadoFiltro, limit, (page - 1) * limit]);
    return { total, rows };
  }

  /** Reserva, titular y eventos en una sola transacción. */
  async create(data: NewReservation, events: OutgoingEvent[]): Promise<ReservationRow> {
    return this.db.transaction(async (m) => {
      const tickets = data.adultos + data.ninos + data.seniors + data.infantes;
      const [row] = await m.query(
        `INSERT INTO reserva (res_uuid, res_codigo, ord_numero, det_id, dis_id, est_id, gui_id, res_saga_id, res_adultos, res_ninos, res_seniors, res_infantes,
           res_numero_tickets, res_precio_total, res_requerimientos, res_voucher_qr, cla_id_cliente, res_canal)
         VALUES ($1, $2, $3, $4, $5, ${estado('PENDING')}, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING res_id`,
        [data.uuid, data.codigo, data.ordNumero, data.detId, data.disId, data.guiId, data.sagaId, data.adultos, data.ninos, data.seniors, data.infantes, tickets, data.total, data.requerimientos, data.voucher, data.claIdCliente, data.canal],
      );
      const c = data.customer;
      await m.query(
        `INSERT INTO reserva_pasajero (res_id, pax_nombre, pax_tipo_documento, pax_documento, pax_correo, pax_telefono, pax_es_titular)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [row.res_id, c.nombre, c.tipoDocumento, c.documento, c.correo, c.telefono],
      );
      for (const event of events) await this.events.record(m, event.tipo, data.codigo, event.payload);
      return (await this.find(data.codigo, m)) as ReservationRow;
    });
  }

  /**
   * Cambia de estado solo si la reserva sigue en uno de `from`, y escribe sus eventos en la misma transacción. Con `null`,
   * otro proceso ya la cambió: así los consumidores son idempotentes. `within` escribe más filas en la misma transacción
   * (p. ej. el aviso del check-in a Booking Central).
   */
  async transition(
    resId: string,
    from: ReservationState[],
    to: ReservationState,
    sets: Record<string, unknown>,
    events: (row: ReservationRow) => OutgoingEvent[],
    within?: (m: EntityManager, row: ReservationRow) => Promise<void>,
  ): Promise<ReservationRow | null> {
    return this.db.transaction(async (m) => {
      const columns = Object.keys(sets);
      const assignments = [`est_id = ${estado(to)}`, ...columns.map((column, index) => `${column} = $${index + 3}`)];
      const rows = returnedRows(
        await m.query(
          `UPDATE reserva SET ${assignments.join(', ')} WHERE res_id = $1 AND est_id IN (SELECT est_id FROM estado WHERE est_codigo = ANY($2::varchar[])) RETURNING res_id`,
          [resId, from, ...columns.map((column) => sets[column])],
        ),
      );
      if (rows.length === 0) return null;
      let [row] = await m.query(`${SELECT} WHERE r.res_id = $1`, [resId]);
      for (const event of events(row)) await this.events.record(m, event.tipo, row.res_codigo, event.payload);
      if (within) {
        await within(m, row);
        [row] = await m.query(`${SELECT} WHERE r.res_id = $1`, [resId]);
      }
      return row;
    });
  }

  /** Guarda el reembolso sin cambiar el estado. */
  async recordRefund(ordNumero: string, reembolsoId: string, monto: number): Promise<void> {
    await this.db.query(`UPDATE reserva SET res_reembolso_id = $2, res_monto_reembolsado = $3 WHERE ord_numero = $1`, [ordNumero, reembolsoId, monto]);
  }

  byState(state: ReservationState, olderThanMinutes: number): Promise<ReservationRow[]> {
    return this.db.query(`${SELECT} WHERE e.est_codigo = $1 AND r.res_creado_en < now() - make_interval(mins => $2) ORDER BY r.res_id LIMIT 200`, [state, olderThanMinutes]);
  }

  /** `CHECKED_IN` de días anteriores en la zona del negocio. */
  checkedInBefore(today: string, timeZone: string): Promise<ReservationRow[]> {
    return this.db.query(
      `${SELECT} WHERE e.est_codigo = 'CHECKED_IN' AND (r.res_checkin_en AT TIME ZONE $2)::date < $1::date ORDER BY r.res_id LIMIT 200`,
      [today, timeZone],
    );
  }
}
