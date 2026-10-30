import { recordEvent } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { RatingSummaryDto } from '../contract';

interface SummaryRow {
  total: number;
  puntuacion: string;
  limpieza: string;
  servicio: string;
  calidad_precio: string;
  puntualidad: string;
  version: string;
}

const COLUMNS = `cal_total AS total, cal_puntuacion AS puntuacion, cal_limpieza AS limpieza, cal_servicio AS servicio,
  cal_calidad_precio AS calidad_precio, cal_puntualidad AS puntualidad, cal_version AS version`;

/** `numeric` y `bigint` llegan como texto desde `pg`. */
const toSummary = (attractionId: string, row: SummaryRow | undefined): RatingSummaryDto => ({
  attraction_id: attractionId,
  score: Number(row?.puntuacion ?? 0),
  review_count: row?.total ?? 0,
  breakdown: {
    limpieza: Number(row?.limpieza ?? 0),
    servicio: Number(row?.servicio ?? 0),
    calidad_precio: Number(row?.calidad_precio ?? 0),
    puntualidad: Number(row?.puntualidad ?? 0),
  },
  version: Number(row?.version ?? 0),
});

/** Resumen de las reseñas visibles por atracción (lo que Catalog muestra como `rating` y `review_count`). */
export class SummaryRepository {
  constructor(private readonly db: DataSource) {}

  /** Resumen guardado; ceros si la atracción todavía no tiene reseñas. */
  async get(attractionId: string): Promise<RatingSummaryDto> {
    const [row]: SummaryRow[] = await this.db.query(`SELECT ${COLUMNS} FROM atraccion_calificacion WHERE atr_codigo = $1`, [attractionId]);
    return toSummary(attractionId, row);
  }

  /**
   * Recalcula el resumen dentro de la transacción del cambio, sube la versión y registra `ResenaPublicada` en el
   * outbox. La transacción debe tener la atracción bloqueada (`lockAttraction`) para que dos cambios simultáneos no se
   * calculen sobre datos viejos.
   */
  async recalculate(m: EntityManager, attractionId: string): Promise<RatingSummaryDto> {
    const [row]: SummaryRow[] = await m.query(
      `INSERT INTO atraccion_calificacion (atr_codigo, cal_total, cal_puntuacion, cal_limpieza, cal_servicio, cal_calidad_precio, cal_puntualidad, cal_version)
       SELECT $1, count(*)::int, coalesce(round(avg(ren_puntuacion), 1), 0), coalesce(round(avg(ren_limpieza), 1), 0),
              coalesce(round(avg(ren_servicio), 1), 0), coalesce(round(avg(ren_calidad_precio), 1), 0),
              coalesce(round(avg(ren_puntualidad), 1), 0), 1
         FROM resena WHERE atr_codigo = $1 AND ren_visible
       ON CONFLICT (atr_codigo) DO UPDATE SET
         cal_total = EXCLUDED.cal_total, cal_puntuacion = EXCLUDED.cal_puntuacion, cal_limpieza = EXCLUDED.cal_limpieza,
         cal_servicio = EXCLUDED.cal_servicio, cal_calidad_precio = EXCLUDED.cal_calidad_precio,
         cal_puntualidad = EXCLUDED.cal_puntualidad, cal_version = atraccion_calificacion.cal_version + 1, cal_actualizado_en = now()
       RETURNING ${COLUMNS}`,
      [attractionId],
    );
    const summary = toSummary(attractionId, row);
    await recordEvent(m, { tipoEvento: 'ResenaPublicada', agregadoId: attractionId, payload: { ...summary } });
    return summary;
  }
}

/** Serializa los cambios de reseñas de una misma atracción hasta el fin de la transacción. */
export async function lockAttraction(m: EntityManager, attractionId: string): Promise<void> {
  await m.query(`SELECT pg_advisory_xact_lock(hashtext('resena:' || $1))`, [attractionId]);
}
