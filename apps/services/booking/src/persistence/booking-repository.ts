import { randomBytes } from 'node:crypto';
import { currentCorrelationId, newCorrelationId, recordEvent } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';

export interface Ticket {
  ticket_type: string;
  cantidad: number;
}

export interface CustomerData {
  full_name: string;
  email: string;
  phone: string;
  document_type: string;
  document_id: string;
}

export interface PassengerData {
  full_name: string;
  document_id: string;
  ticket_type: string;
}

export interface NewReservation {
  externalOrderId: string;
  principalTipo: string;
  principalId: string;
  atraccionCodigo: string;
  fecha: string;
  hora: string;
  boletos: Ticket[];
  total: number;
  moneda: string;
  customer: CustomerData;
  passengers: PassengerData[];
  guiaCodigo: string;
  puntoEncuentro: string;
  cancelableHasta: string | null;
  observaciones: string | null;
}

/** Reserva completa, tal como la guarda Booking. */
export interface ReservationRecord {
  id: string;
  codigo_pnr: string;
  codigo_externo_orden: string;
  principal_tipo: string;
  principal_id: string;
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  estado: string;
  total: number;
  moneda: string;
  titular_nombre: string;
  titular_email: string;
  titular_telefono: string;
  titular_tipo_documento: string;
  titular_numero_documento: string;
  guia_codigo: string;
  punto_encuentro: string;
  cancelable_hasta: string | null;
  observaciones: string | null;
  creado_en: string;
  boletos: Ticket[];
  pasajeros: PassengerData[];
  checkin: { realizado_en: string; documento_presentado: string; guia_codigo: string | null } | null;
  cancelacion: { cancelado_en: string; motivo: string; solicitante: string; reembolso_codigo: string | null; monto_reembolsado: number | null } | null;
}

export interface ListFilters {
  principal: { tipo: string; id: string } | null;
  estado: string | null;
  desde: string | null;
  hasta: string | null;
  codigo: string | null;
  search: string | null;
  orden: string | null;
  limit: number;
  offset: number;
}

const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newPnr = () => `DEC-${Array.from(randomBytes(6), (b) => PNR_ALPHABET[b % PNR_ALPHABET.length]).join('')}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Datos mínimos del evento: sin datos personales del titular (plan §6.2). */
export const eventPayload = (r: Pick<ReservationRecord, 'id' | 'codigo_pnr' | 'codigo_externo_orden' | 'atraccion_codigo' | 'fecha' | 'hora' | 'estado' | 'boletos'>) => ({
  reservation_id: r.id,
  reservation_code: r.codigo_pnr,
  external_order_id: r.codigo_externo_orden,
  atraccion_codigo: r.atraccion_codigo,
  fecha: r.fecha,
  hora: r.hora,
  estado: r.estado,
  ticket_count: r.boletos.reduce((sum, b) => sum + b.cantidad, 0),
});

/** Registra una transición de estado con el `correlation_id` de la petición en curso. */
export async function recordHistory(m: EntityManager, reservaId: string, estado: string, motivo: string | null): Promise<void> {
  await m.query(
    `INSERT INTO reserva_historial_estado (reserva_id, estado, motivo, correlation_id) VALUES ($1, $2, $3, $4)`,
    [reservaId, estado, motivo, currentCorrelationId() ?? newCorrelationId()],
  );
}

export class BookingRepository {
  constructor(private readonly db: DataSource) {}

  /** Busca por UUID, PNR o código de la orden externa. */
  async find(id: string, m: DataSource | EntityManager = this.db, lock = false): Promise<ReservationRecord | null> {
    const [row] = await m.query(
      `SELECT id, codigo_pnr, codigo_externo_orden, principal_tipo, principal_id, atraccion_codigo, fecha::text AS fecha, hora::text AS hora,
              estado, total, moneda, titular_nombre, titular_email, titular_telefono, titular_tipo_documento, titular_numero_documento,
              guia_codigo, punto_encuentro, cancelable_hasta, observaciones, creado_en
         FROM reserva
        WHERE ${UUID.test(id) ? 'id = $1::uuid' : 'codigo_pnr = upper($1) OR codigo_externo_orden = $1'}
        ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    if (!row) return null;
    const [boletos, pasajeros, [checkin], [cancelacion]] = await Promise.all([
      m.query(`SELECT tipo_boleto AS ticket_type, cantidad FROM reserva_boleto WHERE reserva_id = $1 ORDER BY tipo_boleto`, [row.id]),
      m.query(`SELECT nombre_completo AS full_name, coalesce(numero_documento, '') AS document_id, tipo_boleto AS ticket_type FROM reserva_pasajero WHERE reserva_id = $1 ORDER BY nombre_completo`, [row.id]),
      m.query(`SELECT realizado_en, documento_presentado, guia_codigo FROM reserva_checkin WHERE reserva_id = $1`, [row.id]),
      m.query(`SELECT cancelado_en, motivo, solicitante, reembolso_codigo, monto_reembolsado FROM reserva_cancelacion WHERE reserva_id = $1`, [row.id]),
    ]);
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
    return {
      ...row,
      total: Number(row.total),
      cancelable_hasta: iso(row.cancelable_hasta),
      creado_en: iso(row.creado_en)!,
      boletos: boletos.map((b: Ticket) => ({ ticket_type: b.ticket_type, cantidad: Number(b.cantidad) })),
      pasajeros,
      checkin: checkin ? { realizado_en: iso(checkin.realizado_en)!, documento_presentado: checkin.documento_presentado, guia_codigo: checkin.guia_codigo } : null,
      cancelacion: cancelacion
        ? { cancelado_en: iso(cancelacion.cancelado_en)!, motivo: cancelacion.motivo, solicitante: cancelacion.solicitante, reembolso_codigo: cancelacion.reembolso_codigo,
            monto_reembolsado: cancelacion.monto_reembolsado === null ? null : Number(cancelacion.monto_reembolsado) }
        : null,
    };
  }

  /**
   * Cancela la reserva dentro de una transacción con la fila bloqueada. `check` valida reglas con la reserva actual (dueño,
   * plazo) antes de cambiar nada. Si ya estaba cancelada, solo completa los datos del reembolso si faltaban.
   */
  async cancel(
    id: string,
    data: { motivo: string; solicitante: string; reembolsoCodigo: string | null; montoReembolsado: number | null; soloValidar: boolean },
    check: (record: ReservationRecord) => void | Promise<void>,
  ): Promise<ReservationRecord | null> {
    const reservaId = await this.db.transaction(async (m) => {
      const record = await this.find(id, m, true);
      if (!record) return null;
      await check(record);
      if (data.soloValidar) return record.id;
      if (record.estado === 'CANCELLED') {
        if (data.reembolsoCodigo && !record.cancelacion?.reembolso_codigo) {
          await m.query(
            `UPDATE reserva_cancelacion SET reembolso_codigo = $2, monto_reembolsado = $3 WHERE reserva_id = $1`,
            [record.id, data.reembolsoCodigo, data.montoReembolsado ?? 0],
          );
        }
        return record.id;
      }
      await m.query(
        `INSERT INTO reserva_cancelacion (reserva_id, motivo, solicitante, cancelado_en, reembolso_codigo, monto_reembolsado) VALUES ($1, $2, $3, now(), $4, $5)`,
        [record.id, data.motivo.slice(0, 500), data.solicitante, data.reembolsoCodigo, data.reembolsoCodigo ? data.montoReembolsado ?? 0 : null],
      );
      await m.query(`UPDATE reserva SET estado = 'CANCELLED', actualizado_en = now(), version = version + 1 WHERE id = $1`, [record.id]);
      await recordHistory(m, record.id, 'CANCELLED', data.motivo.slice(0, 500));
      await recordEvent(m, { tipoEvento: 'ReservaCancelada', agregadoId: record.codigo_pnr, payload: { ...eventPayload(record), estado: 'CANCELLED', solicitante: data.solicitante } });
      return record.id;
    });
    return reservaId ? this.find(reservaId) : null;
  }

  /** Registra el check-in (la validación de identidad, voucher y fecha la hace `check` con la fila bloqueada). */
  async checkIn(
    id: string,
    data: { documento: string; guiaCodigo: string | null; dispositivo: string | null },
    check: (record: ReservationRecord) => void | Promise<void>,
  ): Promise<ReservationRecord | null> {
    const reservaId = await this.db.transaction(async (m) => {
      const record = await this.find(id, m, true);
      if (!record) return null;
      await check(record);
      await m.query(
        `INSERT INTO reserva_checkin (reserva_id, realizado_en, guia_codigo, dispositivo, documento_presentado) VALUES ($1, now(), $2, $3, $4)`,
        [record.id, data.guiaCodigo, data.dispositivo, data.documento],
      );
      await m.query(`UPDATE reserva SET estado = 'CHECKED_IN', actualizado_en = now(), version = version + 1 WHERE id = $1`, [record.id]);
      await recordHistory(m, record.id, 'CHECKED_IN', 'Check-in presencial en el punto de encuentro');
      await recordEvent(m, { tipoEvento: 'CheckinRealizado', agregadoId: record.codigo_pnr, payload: { ...eventPayload(record), estado: 'CHECKED_IN' } });
      return record.id;
    });
    return reservaId ? this.find(reservaId) : null;
  }

  /**
   * Página de reservas con sus boletos, check-in y cancelación (sin pasajeros: el detalle los trae). `principal` limita
   * a las de ese dueño; `null` = todas (administración).
   */
  async list(filters: ListFilters): Promise<{ total: number; items: ReservationRecord[] }> {
    const params: unknown[] = [];
    const add = (v: unknown) => `$${params.push(v)}`;
    const where: string[] = ['true'];
    if (filters.principal) where.push(`r.principal_tipo = ${add(filters.principal.tipo)} AND r.principal_id = ${add(filters.principal.id)}::uuid`);
    if (filters.estado) where.push(`r.estado = ${add(filters.estado)}`);
    if (filters.desde) where.push(`r.fecha >= ${add(filters.desde)}::date`);
    if (filters.hasta) where.push(`r.fecha <= ${add(filters.hasta)}::date`);
    if (filters.codigo) where.push(`r.atraccion_codigo = ${add(filters.codigo)}`);
    if (filters.search) {
      const p = add(filters.search);
      where.push(`(r.codigo_pnr = upper(${p}) OR r.codigo_externo_orden = ${p} OR lower(r.titular_email) = lower(${p}) OR r.titular_nombre ILIKE '%' || ${p} || '%')`);
    }
    const condition = where.join(' AND ');
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM reserva r WHERE ${condition}`, params);
    const order = filters.orden === 'fecha' ? 'r.fecha, r.hora' : filters.orden === '-fecha' ? 'r.fecha DESC, r.hora DESC' : 'r.creado_en DESC';
    const rows = await this.db.query(
      `SELECT r.id, r.codigo_pnr, r.codigo_externo_orden, r.principal_tipo, r.principal_id, r.atraccion_codigo, r.fecha::text AS fecha, r.hora::text AS hora,
              r.estado, r.total, r.moneda, r.titular_nombre, r.titular_email, r.titular_telefono, r.titular_tipo_documento, r.titular_numero_documento,
              r.guia_codigo, r.punto_encuentro, r.cancelable_hasta, r.observaciones, r.creado_en,
              coalesce((SELECT json_agg(json_build_object('ticket_type', b.tipo_boleto, 'cantidad', b.cantidad) ORDER BY b.tipo_boleto)
                          FROM reserva_boleto b WHERE b.reserva_id = r.id), '[]') AS boletos,
              ci.realizado_en AS ci_realizado_en, ci.documento_presentado AS ci_documento, ci.guia_codigo AS ci_guia,
              ca.cancelado_en AS ca_cancelado_en, ca.motivo AS ca_motivo, ca.solicitante AS ca_solicitante, ca.reembolso_codigo AS ca_reembolso, ca.monto_reembolsado AS ca_monto
         FROM reserva r
         LEFT JOIN reserva_checkin ci ON ci.reserva_id = r.id
         LEFT JOIN reserva_cancelacion ca ON ca.reserva_id = r.id
        WHERE ${condition} ORDER BY ${order}, r.id LIMIT ${add(filters.limit)} OFFSET ${add(filters.offset)}`,
      params,
    );
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
    return {
      total,
      items: rows.map((row: Record<string, unknown>) => ({
        ...(row as unknown as ReservationRecord),
        total: Number(row.total),
        cancelable_hasta: iso(row.cancelable_hasta),
        creado_en: iso(row.creado_en)!,
        boletos: (row.boletos as Ticket[]).map((b) => ({ ticket_type: b.ticket_type, cantidad: Number(b.cantidad) })),
        pasajeros: [],
        checkin: row.ci_realizado_en ? { realizado_en: iso(row.ci_realizado_en)!, documento_presentado: String(row.ci_documento), guia_codigo: (row.ci_guia as string) ?? null } : null,
        cancelacion: row.ca_cancelado_en
          ? { cancelado_en: iso(row.ca_cancelado_en)!, motivo: String(row.ca_motivo), solicitante: String(row.ca_solicitante), reembolso_codigo: (row.ca_reembolso as string) ?? null,
              monto_reembolsado: row.ca_monto === null ? null : Number(row.ca_monto) }
          : null,
      })),
    };
  }

  /** Reservas y boletos por estado y por atracción, por fecha de la actividad. */
  async stats(desde: string | null, hasta: string | null) {
    const params = [desde, hasta];
    const where = `($1::date IS NULL OR r.fecha >= $1::date) AND ($2::date IS NULL OR r.fecha <= $2::date)`;
    const tickets = `(SELECT coalesce(sum(b.cantidad), 0) FROM reserva_boleto b WHERE b.reserva_id = r.id)`;
    const [porEstado, porAtraccion] = await Promise.all([
      this.db.query(`SELECT r.estado, count(*)::int AS reservas, sum(${tickets})::int AS boletos FROM reserva r WHERE ${where} GROUP BY r.estado ORDER BY r.estado`, params),
      this.db.query(
        `SELECT trim(r.atraccion_codigo) AS atraccion_codigo, count(*)::int AS reservas, sum(${tickets})::int AS boletos
           FROM reserva r WHERE ${where} AND r.estado <> 'CANCELLED' GROUP BY r.atraccion_codigo ORDER BY reservas DESC`,
        params,
      ),
    ]);
    return { por_estado: porEstado, por_atraccion: porAtraccion };
  }

  /** Emite la reserva confirmada. Idempotente por orden externa: repetir devuelve la reserva ya emitida. */
  async create(input: NewReservation): Promise<ReservationRecord> {
    const existing = await this.find(input.externalOrderId);
    if (existing) return existing;
    const id = await this.db.transaction(async (m) => {
      let row: { id: string } | undefined;
      for (let attempt = 0; !row && attempt < 5; attempt++) {
        [row] = await m.query(
          `INSERT INTO reserva (codigo_pnr, codigo_externo_orden, principal_tipo, principal_id, atraccion_codigo, fecha, hora, estado, total, moneda,
                                titular_nombre, titular_email, titular_telefono, titular_tipo_documento, titular_numero_documento,
                                guia_codigo, punto_encuentro, cancelable_hasta, observaciones)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'CONFIRMED', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
           ON CONFLICT ON CONSTRAINT uq_reserva_codigo_pnr DO NOTHING
           RETURNING id`,
          [newPnr(), input.externalOrderId, input.principalTipo, input.principalId, input.atraccionCodigo, input.fecha, input.hora, input.total, input.moneda,
            input.customer.full_name, input.customer.email, input.customer.phone, input.customer.document_type, input.customer.document_id,
            input.guiaCodigo, input.puntoEncuentro, input.cancelableHasta, input.observaciones],
        );
      }
      if (!row) throw new Error('No se pudo generar un código PNR único.');
      for (const b of input.boletos.filter((t) => t.cantidad > 0)) {
        await m.query(`INSERT INTO reserva_boleto (reserva_id, tipo_boleto, cantidad) VALUES ($1, $2, $3)`, [row.id, b.ticket_type, b.cantidad]);
      }
      for (const p of input.passengers) {
        await m.query(`INSERT INTO reserva_pasajero (reserva_id, nombre_completo, numero_documento, tipo_boleto) VALUES ($1, $2, $3, $4)`, [row.id, p.full_name, p.document_id || null, p.ticket_type]);
      }
      await recordHistory(m, row.id, 'CONFIRMED', 'Reserva emitida');
      const created = (await this.find(row.id, m))!;
      await recordEvent(m, { tipoEvento: 'ReservaEmitida', agregadoId: created.codigo_pnr, payload: eventPayload(created) });
      return row.id;
    });
    return (await this.find(id))!;
  }
}
