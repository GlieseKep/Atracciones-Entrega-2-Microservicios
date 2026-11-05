import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { GuiaDto } from '../contract';
import { mapUnique } from './sql-errors';

interface GuideRow {
  gui_id: string;
  ope_id: string;
  ope_codigo: string;
  usu_id: string | null;
  gui_codigo: string;
  gui_nombre: string;
  gui_credencial_mintur: string;
  gui_activo: boolean;
}

const SELECT = `SELECT g.gui_id, g.ope_id, o.ope_codigo, g.usu_id, g.gui_codigo, g.gui_nombre, g.gui_credencial_mintur, g.gui_activo
  FROM guia g JOIN operador o ON o.ope_id = g.ope_id`;

const toDto = (row: GuideRow): GuiaDto => ({
  gui_id: Number(row.gui_id),
  codigo: row.gui_codigo,
  nombre: row.gui_nombre,
  credencial_mintur: row.gui_credencial_mintur,
  operador: row.ope_codigo,
  usu_id: row.usu_id === null ? null : Number(row.usu_id),
  activo: row.gui_activo,
});

const UNIQUE = {
  guia_gui_codigo_key: () => AppError.conflict('GUIDE_CODE_EXISTS', 'Ya existe un guía con ese código.'),
  guia_gui_credencial_mintur_key: () => AppError.conflict('GUIDE_CREDENTIAL_EXISTS', 'Ya existe un guía con esa credencial.'),
  uq_guia_usuario: () => AppError.conflict('GUIDE_USER_EXISTS', 'Ese usuario ya está asociado a otro guía.'),
};

export type GuidePatch = Partial<{ gui_nombre: string; gui_credencial_mintur: string; usu_id: number | null; gui_activo: boolean }>;

export class GuideRepository {
  constructor(private readonly db: DataSource) {}

  async list(filters: { opeIds: number[] | null; activo: boolean | null }): Promise<GuiaDto[]> {
    const rows: GuideRow[] = await this.db.query(
      `${SELECT} WHERE ($1::bigint[] IS NULL OR g.ope_id = ANY($1::bigint[])) AND ($2::boolean IS NULL OR g.gui_activo = $2)
       ORDER BY g.gui_nombre`,
      [filters.opeIds, filters.activo],
    );
    return rows.map(toDto);
  }

  async find(codigo: string): Promise<{ guide: GuiaDto; opeId: number } | null> {
    const [row] = await this.db.query(`${SELECT} WHERE g.gui_codigo = $1`, [codigo]);
    return row ? { guide: toDto(row), opeId: Number(row.ope_id) } : null;
  }

  async create(input: { opeId: number; codigo: string; nombre: string; credencial: string; usuId: number | null }): Promise<GuiaDto> {
    await mapUnique(
      () =>
        this.db.query(`INSERT INTO guia (ope_id, usu_id, gui_codigo, gui_nombre, gui_credencial_mintur) VALUES ($1, $2, $3, $4, $5)`, [
          input.opeId,
          input.usuId,
          input.codigo,
          input.nombre,
          input.credencial,
        ]),
      UNIQUE,
    );
    return (await this.find(input.codigo))!.guide;
  }

  async update(codigo: string, patch: GuidePatch): Promise<GuiaDto | null> {
    const columns = Object.keys(patch) as (keyof GuidePatch)[];
    if (columns.length > 0) {
      const sets = columns.map((column, index) => `${column} = $${index + 2}`);
      const rows = returnedRows(
        await mapUnique(
          () => this.db.query(`UPDATE guia SET ${sets.join(', ')} WHERE gui_codigo = $1 RETURNING gui_id`, [codigo, ...columns.map((column) => patch[column])]),
          UNIQUE,
        ),
      );
      if (rows.length === 0) return null;
    }
    return (await this.find(codigo))?.guide ?? null;
  }

  /** Guía activo para una reserva: el indicado, o el primero activo del operador. */
  async forReservation(opeId: number, guiId: number | null): Promise<{ gui_id: number; nombre: string } | null> {
    const [row] = await this.db.query(
      `SELECT gui_id, gui_nombre FROM guia WHERE ope_id = $1 AND gui_activo AND ($2::bigint IS NULL OR gui_id = $2) ORDER BY gui_id LIMIT 1`,
      [opeId, guiId],
    );
    return row ? { gui_id: Number(row.gui_id), nombre: row.gui_nombre } : null;
  }
}
