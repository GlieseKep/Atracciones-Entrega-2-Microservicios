import { AppError, recordEvent, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { ResenaInput, ResenaPublicada } from '../contract';

export interface ReviewRow {
  ren_id: string;
  atr_id: string;
  usu_id: string | null;
  ren_autor_nombre: string | null;
  ren_puntuacion: number;
  ren_limpieza: number;
  ren_servicio: number;
  ren_calidad_precio: number;
  ren_puntualidad: number;
  ren_comentario: string;
  ren_visible: boolean;
  ren_creado_en: Date;
}

const COLUMNS = `ren_id, atr_id, usu_id, ren_autor_nombre, ren_puntuacion, ren_limpieza, ren_servicio, ren_calidad_precio,
  ren_puntualidad, ren_comentario, ren_visible, ren_creado_en`;

const notFound = (id: number) => AppError.notFound(`No existe la reseña ${id}.`, 'REVIEW_NOT_FOUND');

export interface ReviewFilters {
  atrId: number | null;
  usuId: number | null;
  visible: boolean | null;
}

export class ReviewRepository {
  constructor(private readonly db: DataSource) {}

  async list(filters: ReviewFilters, page: number, limit: number): Promise<{ total: number; rows: ReviewRow[] }> {
    const where = `WHERE ($1::bigint IS NULL OR atr_id = $1) AND ($2::bigint IS NULL OR usu_id = $2) AND ($3::boolean IS NULL OR ren_visible = $3)`;
    const params = [filters.atrId, filters.usuId, filters.visible];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM resena ${where}`, params);
    const rows = await this.db.query(`SELECT ${COLUMNS} FROM resena ${where} ORDER BY ren_creado_en DESC, ren_id DESC LIMIT $4 OFFSET $5`, [
      ...params,
      limit,
      (page - 1) * limit,
    ]);
    return { total, rows };
  }

  /** Los promedios de una atracción cambian de a uno: se recalculan y publican bajo un bloqueo por `atr_id`. */
  private inAttractionLock<T>(atrId: number, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [atrId]);
      return work(m);
    });
  }

  private async publishAverages(atrId: number, renId: number, m: EntityManager): Promise<void> {
    const [row] = await m.query(
      `SELECT COALESCE(round(avg(ren_puntuacion), 2), 0)::float8 AS promedio,
              COALESCE(round(avg(ren_limpieza), 2), 0)::float8 AS limpieza,
              COALESCE(round(avg(ren_servicio), 2), 0)::float8 AS servicio,
              COALESCE(round(avg(ren_calidad_precio), 2), 0)::float8 AS calidad_precio,
              COALESCE(round(avg(ren_puntualidad), 2), 0)::float8 AS puntualidad,
              count(*)::int AS numero_resenas
       FROM resena WHERE atr_id = $1 AND ren_visible`,
      [atrId],
    );
    const payload: ResenaPublicada = { atr_id: atrId, ren_id: renId, ...row };
    await recordEvent(m, { tipoEvento: 'RESENA_PUBLICADA', agregadoId: String(atrId), payload: { ...payload } });
  }

  private insert(m: EntityManager, atrId: number, usuId: number | null, autorNombre: string | null, visible: boolean, input: ResenaInput): Promise<ReviewRow[]> {
    return m.query(
      `INSERT INTO resena (atr_id, usu_id, ren_autor_nombre, ren_puntuacion, ren_limpieza, ren_servicio, ren_calidad_precio, ren_puntualidad, ren_comentario, ren_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLUMNS}`,
      [atrId, usuId, autorNombre, input.puntuacion, input.limpieza, input.servicio, input.calidad_precio, input.puntualidad, input.comentario, visible],
    );
  }

  /** Reseña de un usuario: queda visible y actualiza los promedios. */
  createForUser(atrId: number, usuId: number, input: ResenaInput): Promise<ReviewRow> {
    return this.inAttractionLock(atrId, async (m) => {
      try {
        const [row] = await this.insert(m, atrId, usuId, null, true, input);
        await this.publishAverages(atrId, Number(row.ren_id), m);
        return row;
      } catch (error) {
        const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
        if (driver?.code === '23505' && driver.constraint === 'uq_resena_atraccion_usuario') {
          throw AppError.conflict('REVIEW_ALREADY_EXISTS', 'Ya reseñó esta atracción.');
        }
        throw error;
      }
    });
  }

  /** Reseña anónima: queda oculta hasta que un administrador la apruebe, así que no cambia los promedios. */
  async createAnonymous(atrId: number, autorNombre: string, input: ResenaInput): Promise<ReviewRow> {
    const [row] = await this.db.transaction((m) => this.insert(m, atrId, null, autorNombre, false, input));
    return row;
  }

  /** Solo el autor edita. Una reseña oculta sigue oculta: editarla no salta la moderación. */
  async updateOwn(id: number, usuId: number, input: ResenaInput): Promise<ReviewRow> {
    const [current] = await this.db.query(`SELECT atr_id FROM resena WHERE ren_id = $1 AND usu_id = $2`, [id, usuId]);
    if (!current) throw notFound(id);
    const atrId = Number(current.atr_id);
    return this.inAttractionLock(atrId, async (m) => {
      const rows = returnedRows<ReviewRow>(
        await m.query(
          `UPDATE resena SET ren_puntuacion = $2, ren_limpieza = $3, ren_servicio = $4, ren_calidad_precio = $5, ren_puntualidad = $6, ren_comentario = $7
           WHERE ren_id = $1 RETURNING ${COLUMNS}`,
          [id, input.puntuacion, input.limpieza, input.servicio, input.calidad_precio, input.puntualidad, input.comentario],
        ),
      );
      if (rows[0].ren_visible) await this.publishAverages(atrId, id, m);
      return rows[0];
    });
  }

  /** Aprobar u ocultar. Si el valor no cambia, no publica nada. */
  async setVisible(id: number, visible: boolean): Promise<ReviewRow> {
    const [current] = await this.db.query(`SELECT atr_id FROM resena WHERE ren_id = $1`, [id]);
    if (!current) throw notFound(id);
    const atrId = Number(current.atr_id);
    return this.inAttractionLock(atrId, async (m) => {
      const rows = returnedRows<ReviewRow>(await m.query(`UPDATE resena SET ren_visible = $2 WHERE ren_id = $1 AND ren_visible <> $2 RETURNING ${COLUMNS}`, [id, visible]));
      if (rows.length === 0) {
        const [row] = await m.query(`SELECT ${COLUMNS} FROM resena WHERE ren_id = $1`, [id]);
        return row;
      }
      await this.publishAverages(atrId, id, m);
      return rows[0];
    });
  }
}
