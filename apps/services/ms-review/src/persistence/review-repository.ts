import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { ModerationFilters, PageFilters, ReviewCreate, ReviewSort, Visibility } from '../application/review-input';
import type { RatingSummaryDto } from '../contract';
import { lockAttraction, type SummaryRepository } from './summary-repository';

/** Fila de `resena` con los nombres que usa la aplicación (el autor se resuelve después, con Identity). */
export interface ReviewRow {
  id: number;
  attraction_id: string;
  usu_id: string | null;
  autor_nombre: string | null;
  verified_purchase: boolean;
  score: number;
  limpieza: number;
  servicio: number;
  calidad_precio: number;
  puntualidad: number;
  comment: string | null;
  visible: boolean;
  hidden_reason: string | null;
  created_at: string;
}

const COLUMNS = `ren_id AS id, atr_codigo AS attraction_id, usu_id, ren_autor_nombre AS autor_nombre, (res_codigo IS NOT NULL) AS verified_purchase,
  ren_puntuacion AS score, ren_limpieza AS limpieza, ren_servicio AS servicio, ren_calidad_precio AS calidad_precio,
  ren_puntualidad AS puntualidad, ren_comentario AS comment, ren_visible AS visible, ren_motivo_ocultamiento AS hidden_reason,
  ren_creado_en AS created_at`;

const ORDER: Record<ReviewSort, string> = {
  RECENT: 'ren_creado_en DESC, ren_id DESC',
  SCORE_DESC: 'ren_puntuacion DESC, ren_creado_en DESC, ren_id DESC',
  SCORE_ASC: 'ren_puntuacion ASC, ren_creado_en DESC, ren_id DESC',
};

/** `bigint`, `numeric` y fechas llegan como texto u objeto desde `pg`. */
const normalize = (row: Record<string, unknown>): ReviewRow => ({
  ...(row as unknown as ReviewRow),
  id: Number(row.id),
  score: Number(row.score),
  limpieza: Number(row.limpieza),
  servicio: Number(row.servicio),
  calidad_precio: Number(row.calidad_precio),
  puntualidad: Number(row.puntualidad),
  created_at: new Date(row.created_at as string).toISOString(),
});

const alreadyReviewed = () =>
  AppError.conflict('REVIEW_ALREADY_EXISTS', 'Ya publicó una reseña de esta atracción o la reserva ya se usó para otra reseña.');

/** Reseñas. Publicar u ocultar recalcula el resumen de la atracción y registra el evento en la misma transacción. */
export class ReviewRepository {
  constructor(
    private readonly db: DataSource,
    private readonly summaries: SummaryRepository,
  ) {}

  async listVisible(attractionId: string, filters: PageFilters & { sort: ReviewSort }): Promise<{ total: number; items: ReviewRow[] }> {
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM resena WHERE atr_codigo = $1 AND ren_visible`, [attractionId]);
    const rows = await this.db.query(
      `SELECT ${COLUMNS} FROM resena WHERE atr_codigo = $1 AND ren_visible ORDER BY ${ORDER[filters.sort]} LIMIT $2 OFFSET $3`,
      [attractionId, filters.limit, (filters.page - 1) * filters.limit],
    );
    return { total, items: rows.map(normalize) };
  }

  /** Reseñas del usuario, también las ocultas. */
  async listMine(userId: string): Promise<ReviewRow[]> {
    const rows = await this.db.query(`SELECT ${COLUMNS} FROM resena WHERE usu_id = $1 ORDER BY ren_creado_en DESC, ren_id DESC`, [userId]);
    return rows.map(normalize);
  }

  async listForModeration(filters: ModerationFilters): Promise<{ total: number; items: ReviewRow[] }> {
    const where = `($1::boolean IS NULL OR ren_visible = $1) AND ($2::char(12) IS NULL OR atr_codigo = $2)
      AND ($3::numeric IS NULL OR ren_puntuacion <= $3)`;
    const params = [filters.visible, filters.attractionId, filters.maxScore];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM resena WHERE ${where}`, params);
    const rows = await this.db.query(
      `SELECT ${COLUMNS} FROM resena WHERE ${where} ORDER BY ren_creado_en DESC, ren_id DESC LIMIT $4 OFFSET $5`,
      [...params, filters.limit, (filters.page - 1) * filters.limit],
    );
    return { total, items: rows.map(normalize) };
  }

  /** Publica la reseña de un usuario sobre una reserva ya verificada con Booking. */
  async create(attractionId: string, userId: string, reservationId: string, input: ReviewCreate): Promise<{ review: ReviewRow; summary: RatingSummaryDto }> {
    try {
      return await this.db.transaction(async (m) => {
        await lockAttraction(m, attractionId);
        const [row] = await m.query(
          `INSERT INTO resena (atr_codigo, usu_id, res_codigo, ren_puntuacion, ren_limpieza, ren_servicio, ren_calidad_precio, ren_puntualidad, ren_comentario)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
          [attractionId, userId, reservationId, input.score, input.breakdown.limpieza, input.breakdown.servicio,
            input.breakdown.calidad_precio, input.breakdown.puntualidad, input.comment],
        );
        const summary = await this.summaries.recalculate(m, attractionId);
        return { review: normalize(row), summary };
      });
    } catch (error) {
      const driver = (error as { driverError?: { code?: string } }).driverError;
      if (driver?.code === '23505') throw alreadyReviewed();
      throw error;
    }
  }

  /** Oculta o vuelve a mostrar una reseña; `null` si no existe. */
  async setVisibility(id: number, visibility: Visibility): Promise<ReviewRow | null> {
    return this.db.transaction(async (m) => {
      const [current]: { atr_codigo: string }[] = await m.query(`SELECT atr_codigo FROM resena WHERE ren_id = $1`, [id]);
      if (!current) return null;
      await lockAttraction(m, current.atr_codigo);
      const [row] = returnedRows<Record<string, unknown>>(await m.query(
        `UPDATE resena SET ren_visible = $2, ren_motivo_ocultamiento = $3, ren_moderada_en = now()
          WHERE ren_id = $1 RETURNING ${COLUMNS}`,
        [id, visibility.visible, visibility.reason],
      ));
      await this.summaries.recalculate(m, current.atr_codigo);
      return normalize(row);
    });
  }
}
