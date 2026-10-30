import { AppError } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { InclusionDto, InclusionType } from '../contract';
import { mapUnique } from './sql-errors';

const toDto = (row: { inc_id: number; inc_tipo: InclusionType; inc_nombre: string; inc_orden: number }): InclusionDto => ({
  id: row.inc_id,
  tipo: row.inc_tipo,
  nombre: row.inc_nombre,
  orden: row.inc_orden,
});

export class InclusionRepository {
  constructor(private readonly db: DataSource) {}

  async list(tipo: InclusionType | null): Promise<InclusionDto[]> {
    const rows = await this.db.query(`SELECT inc_id, inc_tipo, inc_nombre, inc_orden FROM inclusion WHERE $1::varchar IS NULL OR inc_tipo = $1 ORDER BY inc_tipo, inc_orden, inc_nombre`, [tipo]);
    return rows.map(toDto);
  }

  async create(tipo: InclusionType, nombre: string, orden: number): Promise<InclusionDto> {
    const [row] = await mapUnique(
      () => this.db.query(`INSERT INTO inclusion (inc_tipo, inc_nombre, inc_orden) VALUES ($1, $2, $3) RETURNING inc_id, inc_tipo, inc_nombre, inc_orden`, [tipo, nombre, orden]),
      { uq_inclusion_tipo_nombre: () => AppError.conflict('INCLUSION_EXISTS', 'Ya existe esa inclusión.') },
    );
    return toDto(row);
  }

  async listLanguages(): Promise<{ codigo: string; nombre: string }[]> {
    const rows = await this.db.query(`SELECT idi_codigo, idi_nombre FROM idioma ORDER BY idi_nombre`);
    return rows.map((row: { idi_codigo: string; idi_nombre: string }) => ({ codigo: row.idi_codigo, nombre: row.idi_nombre }));
  }
}
