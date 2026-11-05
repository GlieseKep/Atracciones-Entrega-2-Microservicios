import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { IdiomaAdminDto, InclusionDto, InclusionType } from '../contract';
import { mapUnique } from './sql-errors';

interface InclusionRow {
  inc_id: number;
  inc_tipo: InclusionType;
  inc_nombre: string;
  inc_orden: number;
  atracciones?: number;
}

const toDto = (row: InclusionRow): InclusionDto => ({
  id: row.inc_id,
  tipo: row.inc_tipo,
  nombre: row.inc_nombre,
  orden: row.inc_orden,
  atracciones: row.atracciones ?? 0,
});

/** Una atracción con borrado lógico no cuenta como uso. */
const usedBy = (table: 'atraccion_inclusion' | 'atraccion_idioma', column: 'inc_id' | 'idi_id', id: string) => `(
  SELECT count(*)::int FROM ${table} u JOIN atraccion a ON a.atr_id = u.atr_id
  WHERE u.${column} = ${id} AND a.atr_eliminado_en IS NULL)`;

export class InclusionRepository {
  constructor(private readonly db: DataSource) {}

  async list(tipo: InclusionType | null): Promise<InclusionDto[]> {
    const rows: InclusionRow[] = await this.db.query(
      `SELECT i.inc_id, i.inc_tipo, i.inc_nombre, i.inc_orden, ${usedBy('atraccion_inclusion', 'inc_id', 'i.inc_id')} AS atracciones
       FROM inclusion i WHERE $1::varchar IS NULL OR i.inc_tipo = $1 ORDER BY i.inc_tipo, i.inc_orden, i.inc_nombre`,
      [tipo],
    );
    return rows.map(toDto);
  }

  async create(tipo: InclusionType, nombre: string, orden: number): Promise<InclusionDto> {
    const [row] = await mapUnique(
      () => this.db.query(`INSERT INTO inclusion (inc_tipo, inc_nombre, inc_orden) VALUES ($1, $2, $3) RETURNING inc_id, inc_tipo, inc_nombre, inc_orden`, [tipo, nombre, orden]),
      { uq_inclusion_tipo_nombre: () => AppError.conflict('INCLUSION_EXISTS', 'Ya existe esa inclusión.') },
    );
    return toDto(row);
  }

  /** Se quita solo si ninguna atracción la usa: la clave foránea borra en cascada. El bloqueo evita que alguien la marque a la vez. */
  async remove(id: number): Promise<void> {
    await this.db.transaction(async (m) => {
      const [row] = await m.query(`SELECT inc_id FROM inclusion WHERE inc_id = $1 FOR UPDATE`, [id]);
      if (!row) throw AppError.notFound(`No existe la inclusión ${id}.`, 'INCLUSION_NOT_FOUND');
      const [{ total }] = await m.query(`SELECT ${usedBy('atraccion_inclusion', 'inc_id', '$1')} AS total`, [id]);
      if (total > 0) throw AppError.conflict('INCLUSION_IN_USE', `No se puede quitar: la usan ${total} atracciones.`);
      await m.query(`DELETE FROM inclusion WHERE inc_id = $1`, [id]);
    });
  }

  async listLanguages(): Promise<{ codigo: string; nombre: string }[]> {
    const rows = await this.db.query(`SELECT idi_codigo, idi_nombre FROM idioma ORDER BY idi_nombre`);
    return rows.map((row: { idi_codigo: string; idi_nombre: string }) => ({ codigo: row.idi_codigo, nombre: row.idi_nombre }));
  }

  async listLanguagesAdmin(): Promise<IdiomaAdminDto[]> {
    const rows = await this.db.query(`SELECT i.idi_codigo, i.idi_nombre, ${usedBy('atraccion_idioma', 'idi_id', 'i.idi_id')} AS atracciones FROM idioma i ORDER BY i.idi_nombre`);
    return rows.map((row: { idi_codigo: string; idi_nombre: string; atracciones: number }) => ({ codigo: row.idi_codigo, nombre: row.idi_nombre, atracciones: row.atracciones }));
  }

  async createLanguage(codigo: string, nombre: string): Promise<IdiomaAdminDto> {
    await mapUnique(
      () => this.db.query(`INSERT INTO idioma (idi_codigo, idi_nombre) VALUES ($1, $2)`, [codigo, nombre]),
      { idioma_idi_codigo_key: () => AppError.conflict('LANGUAGE_EXISTS', `Ya existe el idioma ${codigo}.`) },
    );
    return { codigo, nombre, atracciones: 0 };
  }

  async renameLanguage(codigo: string, nombre: string): Promise<void> {
    const rows = returnedRows(await this.db.query(`UPDATE idioma SET idi_nombre = $2 WHERE idi_codigo = $1 RETURNING idi_id`, [codigo, nombre]));
    if (rows.length === 0) throw AppError.notFound(`No existe el idioma ${codigo}.`, 'LANGUAGE_NOT_FOUND');
  }

  /** Igual que una inclusión: solo si ninguna atracción lo usa. */
  async removeLanguage(codigo: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const [row] = await m.query(`SELECT idi_id FROM idioma WHERE idi_codigo = $1 FOR UPDATE`, [codigo]);
      if (!row) throw AppError.notFound(`No existe el idioma ${codigo}.`, 'LANGUAGE_NOT_FOUND');
      const [{ total }] = await m.query(`SELECT ${usedBy('atraccion_idioma', 'idi_id', '$1::smallint')} AS total`, [row.idi_id]);
      if (total > 0) throw AppError.conflict('LANGUAGE_IN_USE', `No se puede quitar: lo usan ${total} atracciones.`);
      // Solo quedan filas de atracciones con borrado lógico, y esta clave foránea no borra en cascada.
      await m.query(`DELETE FROM atraccion_idioma WHERE idi_id = $1`, [row.idi_id]);
      await m.query(`DELETE FROM idioma WHERE idi_id = $1`, [row.idi_id]);
    });
  }
}
