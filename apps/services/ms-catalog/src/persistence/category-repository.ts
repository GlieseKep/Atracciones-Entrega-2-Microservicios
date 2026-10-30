import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { mapUnique } from './sql-errors';

export interface CategoryRow {
  cat_id: number;
  cat_codigo: string;
  padre_codigo: string | null;
  cat_padre_id: number | null;
  cat_nombre: string;
  cat_slug: string;
  cat_descripcion: string | null;
  cat_icono: string;
  cat_orden: number;
  cat_incluye_comida: boolean;
  cat_incluye_transporte: boolean;
  cat_incluye_guia: boolean;
  cat_activa: boolean;
}

const SELECT = `SELECT c.cat_id, c.cat_codigo, p.cat_codigo AS padre_codigo, c.cat_padre_id, c.cat_nombre, c.cat_slug, c.cat_descripcion,
    c.cat_icono, c.cat_orden, c.cat_incluye_comida, c.cat_incluye_transporte, c.cat_incluye_guia, c.cat_activa
  FROM categoria c LEFT JOIN categoria p ON p.cat_id = c.cat_padre_id`;

const UNIQUE = {
  categoria_cat_codigo_key: () => AppError.conflict('CATEGORY_EXISTS', 'Ya existe una categoría con ese código.'),
  categoria_cat_slug_key: () => AppError.conflict('CATEGORY_SLUG_EXISTS', 'Ya existe una categoría con ese slug.'),
};

export interface CategoryCreate {
  codigo: string;
  padre: string | null;
  nombre: string;
  slug: string;
  descripcion: string | null;
  icono: string | null;
  orden: number;
  incluyeComida: boolean;
  incluyeTransporte: boolean;
  incluyeGuia: boolean;
}

export type CategoryPatch = Partial<{
  cat_nombre: string;
  cat_descripcion: string | null;
  cat_icono: string;
  cat_orden: number;
  cat_incluye_comida: boolean;
  cat_incluye_transporte: boolean;
  cat_incluye_guia: boolean;
  cat_activa: boolean;
}>;

export class CategoryRepository {
  constructor(private readonly db: DataSource) {}

  listActive(): Promise<CategoryRow[]> {
    return this.db.query(`${SELECT} WHERE c.cat_activa ORDER BY c.cat_orden, c.cat_nombre`);
  }

  /** Hijas directas de `padre`, o las raíz si es `null`. */
  listChildren(padre: string | null): Promise<CategoryRow[]> {
    return this.db.query(
      `${SELECT} WHERE c.cat_activa AND ($1::varchar IS NULL AND c.cat_padre_id IS NULL OR p.cat_codigo = $1) ORDER BY c.cat_orden, c.cat_nombre`,
      [padre],
    );
  }

  async findByCode(codigo: string): Promise<CategoryRow | null> {
    const [row] = await this.db.query(`${SELECT} WHERE c.cat_codigo = $1`, [codigo]);
    return row ?? null;
  }

  async create(input: CategoryCreate, padreId: number | null): Promise<CategoryRow> {
    await mapUnique(
      () =>
        this.db.query(
          `INSERT INTO categoria (cat_codigo, cat_padre_id, cat_nombre, cat_slug, cat_descripcion, cat_icono, cat_orden,
             cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'map-pin'), $7, $8, $9, $10)`,
          [input.codigo, padreId, input.nombre, input.slug, input.descripcion, input.icono, input.orden, input.incluyeComida, input.incluyeTransporte, input.incluyeGuia],
        ),
      UNIQUE,
    );
    return (await this.findByCode(input.codigo)) as CategoryRow;
  }

  async update(codigo: string, patch: CategoryPatch): Promise<CategoryRow | null> {
    const columns = Object.keys(patch) as (keyof CategoryPatch)[];
    if (columns.length > 0) {
      const sets = columns.map((column, index) => `${column} = $${index + 2}`);
      const rows = returnedRows(
        await this.db.query(`UPDATE categoria SET ${sets.join(', ')} WHERE cat_codigo = $1 RETURNING cat_id`, [codigo, ...columns.map((column) => patch[column])]),
      );
      if (rows.length === 0) return null;
    }
    return this.findByCode(codigo);
  }
}
