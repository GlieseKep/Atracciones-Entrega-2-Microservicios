// Copia las reseñas de Catalog (catalog_db.resena) a ms_review y calcula el resumen de cada atracción.
// Plan/ms_review/PLAN_IMPLEMENTACION.md, Fase 4.
//
// Uso:  npm run build && npm run db:migrate -- ms-review && node tools/migrate-reviews-to-review.mjs [--dry-run]
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base (igual que tools/migrate-services.mjs).
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
//
// - atraccion_id → atr_codigo (código público), usuario_id → usu_id, reserva_id → res_codigo; notas y creado_en iguales.
//   Los comentarios de más de 1000 caracteres se recortan (se informa cuáles).
// - Recalcula atraccion_calificacion de las atracciones migradas y deja un review.ResenaPublicada por atracción en el
//   outbox: el relay de ms-review lo publica y Catalog actualiza su proyección.
// - Se puede repetir: una reseña cuya reserva ya está en ms_review se salta.
import pg from 'pg';

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
const dryRun = process.argv.includes('--dry-run');

const connect = async (database) => {
  const client = new pg.Client({ connectionString: `${base}${database}`, ssl });
  await client.connect();
  return client;
};
const catalog = await connect('catalog_db');
const review = await connect('ms_review');

const summary = { origen: 0, copiadas: 0, ya_migradas: 0, comentarios_recortados: 0, atracciones: 0 };
try {
  const { rows } = await catalog.query(
    `SELECT r.reserva_id::text AS res_codigo, a.codigo_publico AS atr_codigo, r.usuario_id::text AS usu_id,
            r.puntuacion_general, r.limpieza, r.servicio, r.calidad_precio, r.puntualidad, r.comentario, r.creado_en
       FROM resena r JOIN atraccion a ON a.id = r.atraccion_id
      ORDER BY r.creado_en`,
  );
  summary.origen = rows.length;
  const attractions = new Set(rows.map((r) => r.atr_codigo));
  summary.atracciones = attractions.size;

  if (dryRun) {
    summary.comentarios_recortados = rows.filter((r) => r.comentario && r.comentario.length > 1000).length;
    console.log('[simulación] Resumen:', summary);
  } else {
    await review.query('BEGIN');
    try {
      for (const r of rows) {
        let comment = r.comentario?.trim() || null;
        if (comment && comment.length > 1000) {
          summary.comentarios_recortados++;
          console.warn(`[recortado] comentario de la reserva ${r.res_codigo} (${comment.length} caracteres → 1000).`);
          comment = `${comment.slice(0, 999)}…`;
        }
        const { rowCount } = await review.query(
          `INSERT INTO resena (atr_codigo, usu_id, res_codigo, ren_puntuacion, ren_limpieza, ren_servicio, ren_calidad_precio, ren_puntualidad,
             ren_comentario, ren_creado_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT DO NOTHING`,
          [r.atr_codigo, r.usu_id, r.res_codigo, r.puntuacion_general, r.limpieza, r.servicio, r.calidad_precio, r.puntualidad, comment, r.creado_en],
        );
        if (rowCount) summary.copiadas++;
        else summary.ya_migradas++;
      }
      // Resumen de cada atracción (mismo cálculo que SummaryRepository.recalculate) y su evento en el outbox.
      for (const codigo of attractions) {
        const { rows: [s] } = await review.query(
          `INSERT INTO atraccion_calificacion (atr_codigo, cal_total, cal_puntuacion, cal_limpieza, cal_servicio, cal_calidad_precio, cal_puntualidad, cal_version)
           SELECT $1, count(*)::int, coalesce(round(avg(ren_puntuacion), 1), 0), coalesce(round(avg(ren_limpieza), 1), 0),
                  coalesce(round(avg(ren_servicio), 1), 0), coalesce(round(avg(ren_calidad_precio), 1), 0),
                  coalesce(round(avg(ren_puntualidad), 1), 0), 1
             FROM resena WHERE atr_codigo = $1 AND ren_visible
           ON CONFLICT (atr_codigo) DO UPDATE SET
             cal_total = EXCLUDED.cal_total, cal_puntuacion = EXCLUDED.cal_puntuacion, cal_limpieza = EXCLUDED.cal_limpieza,
             cal_servicio = EXCLUDED.cal_servicio, cal_calidad_precio = EXCLUDED.cal_calidad_precio,
             cal_puntualidad = EXCLUDED.cal_puntualidad, cal_version = atraccion_calificacion.cal_version + 1, cal_actualizado_en = now()
           RETURNING cal_total, cal_puntuacion, cal_limpieza, cal_servicio, cal_calidad_precio, cal_puntualidad, cal_version`,
          [codigo],
        );
        const payload = {
          attraction_id: codigo,
          score: Number(s.cal_puntuacion),
          review_count: s.cal_total,
          breakdown: { limpieza: Number(s.cal_limpieza), servicio: Number(s.cal_servicio), calidad_precio: Number(s.cal_calidad_precio), puntualidad: Number(s.cal_puntualidad) },
          version: Number(s.cal_version),
        };
        await review.query(
          `INSERT INTO outbox (event_id, tipo_evento, agregado_id, payload, correlation_id) VALUES (gen_random_uuid(), 'ResenaPublicada', $1, $2, $3)`,
          [codigo, JSON.stringify(payload), `migracion-resenas-${Date.now()}`],
        );
      }
      await review.query('COMMIT');
    } catch (error) {
      await review.query('ROLLBACK');
      throw error;
    }
    console.log('Resumen:', summary);
  }
} finally {
  await catalog.end();
  await review.end();
}
