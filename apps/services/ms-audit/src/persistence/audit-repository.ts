import type { DataSource } from 'typeorm';
import type { AuditRecord, BitacoraFilters, EntradaBitacora } from '../contract';

interface EntryRow {
  bit_id: string;
  bit_event_id: string;
  usu_id: string | null;
  bit_accion: string;
  bit_entidad: string;
  bit_entidad_id: string | null;
  bit_correlation_id: string | null;
  bit_detalle: Record<string, unknown> | null;
  bit_ip: string | null;
  bit_creado_en: Date;
}

const toEntry = (row: EntryRow): EntradaBitacora => ({
  id: Number(row.bit_id),
  event_id: row.bit_event_id,
  usu_id: row.usu_id === null ? null : Number(row.usu_id),
  accion: row.bit_accion,
  entidad: row.bit_entidad,
  entidad_id: row.bit_entidad_id,
  correlation_id: row.bit_correlation_id,
  detalle: row.bit_detalle,
  ip: row.bit_ip,
  creado_en: row.bit_creado_en.toISOString(),
});

/** Solo se inserta: la bitácora no se modifica ni se borra. */
export class AuditRepository {
  constructor(private readonly db: DataSource) {}

  /** `bit_creado_en` es la fecha del evento, y `ON CONFLICT` absorbe los eventos repetidos del bus. */
  async record(entry: AuditRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO bitacora (bit_event_id, usu_id, bit_accion, bit_entidad, bit_entidad_id, bit_correlation_id, bit_detalle, bit_creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) ON CONFLICT (bit_event_id) DO NOTHING`,
      [entry.eventId, entry.usuId, entry.accion, entry.entidad, entry.entidadId, entry.correlationId, JSON.stringify(entry.detalle), entry.creadoEn],
    );
  }

  async list(filters: BitacoraFilters): Promise<{ total: number; items: EntradaBitacora[] }> {
    const where = `WHERE ($1::varchar IS NULL OR bit_accion = $1)
      AND ($2::varchar IS NULL OR bit_entidad = $2)
      AND ($3::varchar IS NULL OR bit_entidad_id = $3)
      AND ($4::varchar IS NULL OR bit_correlation_id = $4)
      AND ($5::bigint IS NULL OR usu_id = $5)
      AND ($6::date IS NULL OR bit_creado_en >= $6::date::timestamp AT TIME ZONE 'America/Guayaquil')
      AND ($7::date IS NULL OR bit_creado_en < ($7::date + 1)::timestamp AT TIME ZONE 'America/Guayaquil')`;
    const params = [filters.accion, filters.entidad, filters.entidadId, filters.correlationId, filters.usuId, filters.desde, filters.hasta];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM bitacora ${where}`, params);
    const rows: EntryRow[] = await this.db.query(
      `SELECT bit_id, bit_event_id, usu_id, bit_accion, bit_entidad, bit_entidad_id, bit_correlation_id, bit_detalle, bit_ip, bit_creado_en
       FROM bitacora ${where} ORDER BY bit_creado_en DESC, bit_id DESC LIMIT $8 OFFSET $9`,
      [...params, filters.limit, (filters.page - 1) * filters.limit],
    );
    return { total, items: rows.map(toEntry) };
  }

  async actions(): Promise<string[]> {
    const rows: { bit_accion: string }[] = await this.db.query(`SELECT DISTINCT bit_accion FROM bitacora ORDER BY bit_accion`);
    return rows.map((row) => row.bit_accion);
  }
}
