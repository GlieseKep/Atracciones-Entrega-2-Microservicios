import { AppError, recordEvent, timeLabel, type OutboxEvent } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';

/** Esquema de Inventory (nombre exigido por el contrato para `turnos_aforo`). */
export const S = 'schema_atracciones';

export interface SlotRow {
  fecha: string;
  hora: string;
  cupos_totales: number;
  cupos_disponibles: number;
  precio_adulto: number | null;
  precio_nino: number | null;
  guia_codigo: string | null;
}

export interface TariffRow {
  atraccion_codigo: string;
  moneda: string;
  adult: number;
  child: number;
  senior: number;
  infant: number;
  student: number | null;
}

export interface GuideRow {
  codigo: string;
  titulo: string | null;
  nombre: string;
  credencial_mintur: string | null;
}

export interface Clock {
  /** Fecha y hora local del negocio (`YYYY-MM-DD`, `HH:mm:ss`). */
  now(): { date: string; time: string };
}

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** Condición común: el turno se puede mostrar y vender (abierto, no bloqueado y todavía no empezó). */
const SELLABLE = `
  NOT t.cerrado
  AND NOT EXISTS (SELECT 1 FROM ${S}.fecha_bloqueada fb WHERE fb.atraccion_codigo = t.atraccion_codigo AND fb.fecha = t.fecha)
  AND (t.fecha > $TODAY::date OR (t.fecha = $TODAY::date AND t.hora > $NOW::time))`;

const sellable = (todayParam: number, nowParam: number) =>
  SELLABLE.replace(/\$TODAY/g, () => `$${todayParam}`).replace(/\$NOW/g, () => `$${nowParam}`);

/** Precio de un tipo de boleto: el del turno si tiene uno especial; si no, el de la tarifa vigente en la fecha. */
const priceOf = (tipo: string) => `coalesce(
  (SELECT tp.precio FROM ${S}.turno_precio tp WHERE tp.turno_id = t.id AND tp.tipo_boleto = '${tipo}'),
  (SELECT p.precio FROM ${S}.tarifa ta JOIN ${S}.tarifa_precio p ON p.tarifa_id = ta.id AND p.tipo_boleto = '${tipo}'
    WHERE ta.atraccion_codigo = t.atraccion_codigo AND ta.vigente_desde <= t.fecha AND (ta.vigente_hasta IS NULL OR ta.vigente_hasta >= t.fecha)))`;

export class InventoryRepository {
  constructor(
    private readonly db: DataSource,
    private readonly clock: Clock,
  ) {}

  async availability(codigo: string, fecha: string): Promise<SlotRow[]> {
    const { date, time } = this.clock.now();
    const rows = await this.db.query(
      `SELECT t.fecha::text AS fecha, t.hora::text AS hora, t.cupos_totales, t.cupos_totales - t.cupos_reservados AS cupos_disponibles,
              ${priceOf('ADULT')} AS precio_adulto, ${priceOf('CHILD')} AS precio_nino, g.codigo AS guia_codigo
         FROM ${S}.turnos_aforo t LEFT JOIN ${S}.guia g ON g.id = t.guia_id
        WHERE t.atraccion_codigo = $1 AND t.fecha = $2::date AND ${sellable(3, 4)}
        ORDER BY t.hora`,
      [codigo, fecha, date, time],
    );
    return rows.map((r: SlotRow) => ({ ...r, precio_adulto: num(r.precio_adulto), precio_nino: num(r.precio_nino) }));
  }

  async tariffs(codigos: string[], fecha: string): Promise<TariffRow[]> {
    if (codigos.length === 0) return [];
    const rows = await this.db.query(
      `SELECT ta.atraccion_codigo, ta.moneda,
              max(p.precio) FILTER (WHERE p.tipo_boleto = 'ADULT') AS adult,
              max(p.precio) FILTER (WHERE p.tipo_boleto = 'CHILD') AS child,
              max(p.precio) FILTER (WHERE p.tipo_boleto = 'SENIOR') AS senior,
              max(p.precio) FILTER (WHERE p.tipo_boleto = 'INFANT') AS infant,
              max(p.precio) FILTER (WHERE p.tipo_boleto = 'STUDENT') AS student
         FROM ${S}.tarifa ta JOIN ${S}.tarifa_precio p ON p.tarifa_id = ta.id
        WHERE ta.atraccion_codigo = ANY($1::char(12)[]) AND ta.vigente_desde <= $2::date AND (ta.vigente_hasta IS NULL OR ta.vigente_hasta >= $2::date)
        GROUP BY ta.atraccion_codigo, ta.moneda`,
      [codigos, fecha],
    );
    return rows.map((r: TariffRow) => ({
      atraccion_codigo: r.atraccion_codigo, moneda: r.moneda,
      adult: Number(r.adult), child: Number(r.child), senior: Number(r.senior), infant: Number(r.infant), student: num(r.student),
    }));
  }

  async guide(codigo: string): Promise<GuideRow | null> {
    const [row] = await this.db.query(`SELECT codigo, titulo, nombre, credencial_mintur FROM ${S}.guia WHERE codigo = $1`, [codigo]);
    return row ?? null;
  }

  async withAvailability(codigos: string[], desde: string, hasta: string, cupos: number): Promise<string[]> {
    if (codigos.length === 0) return [];
    const { date, time } = this.clock.now();
    const rows: { atraccion_codigo: string }[] = await this.db.query(
      `SELECT DISTINCT t.atraccion_codigo FROM ${S}.turnos_aforo t
        WHERE t.atraccion_codigo = ANY($1::char(12)[]) AND t.fecha BETWEEN $2::date AND $3::date
          AND t.cupos_totales - t.cupos_reservados >= $4 AND ${sellable(5, 6)}`,
      [codigos, desde, hasta, cupos, date, time],
    );
    return rows.map((r) => r.atraccion_codigo);
  }

  /**
   * Bloquea cupos con una sola actualización condicional (sin sobreventa, plan §3.3). Idempotente por clave: repetir la
   * misma clave devuelve el bloqueo original. Registra los eventos y el envío pendiente a Booking en la misma transacción.
   */
  async reserve(input: { codigo: string; fecha: string; hora: string; cantidad: number; ordenId: string; clave: string }) {
    const { date, time } = this.clock.now();
    return this.db.transaction(async (m) => {
      const [previous] = await m.query(
        `SELECT rc.id, t.cupos_totales - t.cupos_reservados AS disponibles, g.codigo AS guia_codigo
           FROM ${S}.reserva_cupo rc JOIN ${S}.turnos_aforo t ON t.id = rc.turno_id LEFT JOIN ${S}.guia g ON g.id = t.guia_id
          WHERE rc.clave_idempotencia = $1`,
        [input.clave],
      );
      if (previous) return { reservaCupoId: previous.id as string, disponibles: Number(previous.disponibles), guiaCodigo: previous.guia_codigo as string | null };

      const [updated] = await m.query(
        `UPDATE ${S}.turnos_aforo t
            SET cupos_reservados = cupos_reservados + $4, version = version + 1, actualizado_en = now()
          WHERE t.atraccion_codigo = $1 AND t.fecha = $2::date AND t.hora = $3::time
            AND t.cupos_totales - t.cupos_reservados >= $4 AND ${sellable(5, 6)}
        RETURNING t.id, t.cupos_totales, t.cupos_totales - t.cupos_reservados AS disponibles,
                  (SELECT g.codigo FROM ${S}.guia g WHERE g.id = t.guia_id) AS guia_codigo`,
        [input.codigo, input.fecha, input.hora, input.cantidad, date, time],
      ).then((r: unknown[]) => (r[0] as unknown[]) ?? []);
      if (!updated) throw await this.reserveFailure(m, input, date, time);

      const turno = updated as { id: string; cupos_totales: number; disponibles: number; guia_codigo: string | null };
      const [row] = await m.query(
        `INSERT INTO ${S}.reserva_cupo (turno_id, orden_id, cantidad, clave_idempotencia) VALUES ($1, $2, $3, $4) RETURNING id`,
        [turno.id, input.ordenId, input.cantidad, input.clave],
      );
      await this.stockChanged(m, { id: turno.id, codigo: input.codigo, fecha: input.fecha, hora: input.hora, totales: turno.cupos_totales, disponibles: Number(turno.disponibles) }, {
        tipoEvento: 'CupoBloqueado', agregadoId: turno.id, payload: { atraccion_codigo: input.codigo, fecha: input.fecha, hora: input.hora, cantidad: input.cantidad, orden_id: input.ordenId },
      });
      return { reservaCupoId: row.id as string, disponibles: Number(turno.disponibles), guiaCodigo: turno.guia_codigo };
    });
  }

  /** Libera un bloqueo (compensación o cancelación). Si ya estaba liberado o no existe, no hace nada. */
  async release(clave: string): Promise<{ liberado: boolean; disponibles: number }> {
    return this.db.transaction(async (m) => {
      const [cupo] = await m.query(
        `SELECT rc.id, rc.cantidad, rc.liberado_en, rc.turno_id FROM ${S}.reserva_cupo rc WHERE rc.clave_idempotencia = $1 FOR UPDATE`,
        [clave],
      );
      if (!cupo) return { liberado: false, disponibles: 0 };
      if (cupo.liberado_en) {
        const [t] = await m.query(`SELECT cupos_totales - cupos_reservados AS d FROM ${S}.turnos_aforo WHERE id = $1`, [cupo.turno_id]);
        return { liberado: false, disponibles: Number(t?.d ?? 0) };
      }
      const [turno] = await m.query(
        `UPDATE ${S}.turnos_aforo SET cupos_reservados = greatest(cupos_reservados - $2, 0), version = version + 1, actualizado_en = now()
          WHERE id = $1
        RETURNING id, atraccion_codigo, fecha::text AS fecha, hora::text AS hora, cupos_totales, cupos_totales - cupos_reservados AS disponibles`,
        [cupo.turno_id, cupo.cantidad],
      ).then((r: unknown[]) => (r[0] as unknown[]) ?? []);
      await m.query(`UPDATE ${S}.reserva_cupo SET liberado_en = now() WHERE id = $1`, [cupo.id]);
      const t = turno as { id: string; atraccion_codigo: string; fecha: string; hora: string; cupos_totales: number; disponibles: number };
      await this.stockChanged(m, { id: t.id, codigo: t.atraccion_codigo, fecha: t.fecha, hora: t.hora, totales: t.cupos_totales, disponibles: Number(t.disponibles) }, {
        tipoEvento: 'CupoLiberado', agregadoId: t.id, payload: { atraccion_codigo: t.atraccion_codigo, fecha: t.fecha, hora: t.hora, cantidad: Number(cupo.cantidad) },
      });
      return { liberado: true, disponibles: Number(t.disponibles) };
    });
  }

  /** Explica por qué no se pudo bloquear: el turno no existe / no se vende (404) o no tiene cupos suficientes (409). */
  private async reserveFailure(m: EntityManager, input: { codigo: string; fecha: string; hora: string; cantidad: number }, date: string, time: string): Promise<AppError> {
    const [turno] = await m.query(
      `SELECT t.cupos_totales - t.cupos_reservados AS disponibles, (${sellable(4, 5)}) AS vendible
         FROM ${S}.turnos_aforo t WHERE t.atraccion_codigo = $1 AND t.fecha = $2::date AND t.hora = $3::time`,
      [input.codigo, input.fecha, input.hora, date, time],
    );
    if (!turno || !turno.vendible) {
      return AppError.notFound(`La atracción no tiene un turno a la venta el ${input.fecha} a las ${timeLabel(input.hora)}.`, 'SLOT_NOT_FOUND');
    }
    return AppError.conflict(
      'OUT_OF_STOCK',
      `No existen suficientes cupos disponibles en el turno seleccionado (${timeLabel(input.hora)} del ${input.fecha}). Cupos restantes: ${turno.disponibles}, solicitados: ${input.cantidad}.`,
    );
  }

  /**
   * Registra el evento del cambio (si lo hay), `DisponibilidadActualizada` y el envío pendiente a Booking
   * (PushStockUpdate). Lo usan también las operaciones de administración.
   */
  async stockChanged(
    m: EntityManager,
    turno: { id: string; codigo: string; fecha: string; hora: string; totales: number; disponibles: number },
    change: OutboxEvent | null,
  ): Promise<void> {
    if (change) await recordEvent(m, change, S);
    const eventId = await recordEvent(m, {
      tipoEvento: 'DisponibilidadActualizada',
      agregadoId: turno.codigo,
      payload: { atraccion_codigo: turno.codigo, fecha: turno.fecha, hora: turno.hora, time_slot: timeLabel(turno.hora), cupos_totales: turno.totales, cupos_disponibles: turno.disponibles },
    }, S);
    await m.query(
      `INSERT INTO ${S}.sincronizacion_booking (event_id, turno_id, metodo, cupos_disponibles, correlation_id)
       SELECT $1, $2, 'PUSH', $3, o.correlation_id FROM ${S}.outbox o WHERE o.event_id = $1`,
      [eventId, turno.id, turno.disponibles],
    );
  }

  /**
   * Crea los turnos de los próximos días a partir de los horarios vigentes (no toca los que ya existen). Si `syncBooking`,
   * cada turno nuevo queda pendiente de enviarse a Booking como `StreamInventoryChanges` con delta = aforo.
   */
  async generateSlots(from: string, to: string, syncBooking = false, correlationId = 'generacion-de-turnos'): Promise<number> {
    const [{ count }] = await this.db.query(
      `WITH creados AS (
         INSERT INTO ${S}.turnos_aforo (atraccion_codigo, fecha, hora, cupos_totales, guia_id)
         SELECT h.atraccion_codigo, d::date, h.hora_inicio, h.capacidad, h.guia_id
           FROM generate_series($1::date, $2::date, interval '1 day') d
           JOIN ${S}.horario h ON h.activo AND h.dia_semana = extract(isodow FROM d)
                AND h.vigente_desde <= d::date AND (h.vigente_hasta IS NULL OR h.vigente_hasta >= d::date)
          WHERE NOT EXISTS (SELECT 1 FROM ${S}.fecha_bloqueada fb WHERE fb.atraccion_codigo = h.atraccion_codigo AND fb.fecha = d::date)
         ON CONFLICT ON CONSTRAINT uq_turnos_aforo_turno DO NOTHING
         RETURNING id, cupos_totales),
       sincronizados AS (
         INSERT INTO ${S}.sincronizacion_booking (event_id, turno_id, metodo, delta, correlation_id)
         SELECT gen_random_uuid(), id, 'STREAM', cupos_totales, $4 FROM creados WHERE $3
         RETURNING 1)
       SELECT count(*)::int AS count FROM creados`,
      [from, to, syncBooking, correlationId],
    );
    return count;
  }

  /**
   * Recarga de aforo recibida por gRPC (`InventoryStockService`, plan C7): fija los cupos disponibles (`available`) o
   * los suma (`delta`). Los cupos ya vendidos nunca se pierden. No se reenvía a Booking (sería un eco de su propio dato).
   */
  async adjustCapacity(input: { codigo: string; fecha: string; hora: string; available?: number; delta?: number }): Promise<number | null> {
    return this.db.transaction(async (m) => {
      const [turno] = await m.query(
        `UPDATE ${S}.turnos_aforo
            SET cupos_totales = greatest(cupos_reservados, CASE WHEN $4::int IS NOT NULL THEN cupos_reservados + $4::int ELSE cupos_totales + $5::int END),
                version = version + 1, actualizado_en = now()
          WHERE atraccion_codigo = $1 AND fecha = $2::date AND hora = $3::time
        RETURNING id, cupos_totales, cupos_totales - cupos_reservados AS disponibles`,
        [input.codigo, input.fecha, input.hora, input.available ?? null, input.delta ?? 0],
      ).then((r: unknown[]) => (r[0] as unknown[]) ?? []);
      if (!turno) return null;
      const t = turno as { id: string; cupos_totales: number; disponibles: number };
      await recordEvent(m, {
        tipoEvento: 'DisponibilidadActualizada',
        agregadoId: input.codigo,
        payload: { atraccion_codigo: input.codigo, fecha: input.fecha, hora: input.hora, time_slot: timeLabel(input.hora), cupos_totales: t.cupos_totales, cupos_disponibles: Number(t.disponibles) },
      }, S);
      return Number(t.disponibles);
    });
  }
}
