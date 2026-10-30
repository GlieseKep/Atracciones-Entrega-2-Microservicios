// Copia los mensajes de contacto de Audit (audit_db.mensaje_contacto) a ms_support.
// Plan/ms_support/PLAN_IMPLEMENTACION.md, Fase 4.
//
// Uso:  npm run build && npm run db:migrate -- ms-support && node tools/migrate-contact-to-support.mjs [--dry-run]
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base (igual que tools/migrate-services.mjs).
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
//
// - En orden de creado_en: usuario_id → usu_id, email → men_correo, mensaje → men_cuerpo; estado, correlation_id y
//   fechas iguales. Los nombres de más de 120 caracteres se recortan (se informa cuáles).
// - El id cambia de UUID a número (nadie lo guarda fuera de Audit).
// - Se puede repetir (p. ej. para copiar los mensajes que llegaron a Audit durante el corte): un mensaje con el mismo
//   correlation_id, correo y fecha ya migrado se salta.
// - Al final compara la cantidad de mensajes por estado en las dos bases.
import pg from 'pg';

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
const dryRun = process.argv.includes('--dry-run');

const connect = async (database) => {
  const client = new pg.Client({ connectionString: `${base}${database}`, ssl });
  await client.connect();
  return client;
};
const audit = await connect('audit_db');
const support = await connect('ms_support');

const summary = { origen: 0, copiados: 0, ya_migrados: 0, nombres_recortados: 0 };
try {
  const { rows } = await audit.query(
    `SELECT usuario_id::text AS usu_id, btrim(nombre) AS nombre, lower(btrim(email)) AS email, btrim(asunto) AS asunto, btrim(mensaje) AS mensaje,
            estado, correlation_id, creado_en, respondido_en
       FROM mensaje_contacto
      ORDER BY creado_en, id`,
  );
  summary.origen = rows.length;

  if (!dryRun) await support.query('BEGIN');
  try {
    for (const r of rows) {
      let nombre = r.nombre;
      if (nombre.length > 120) {
        summary.nombres_recortados++;
        console.warn(`[recortado] nombre de ${r.email} (${nombre.length} caracteres → 120).`);
        nombre = `${nombre.slice(0, 119)}…`;
      }
      if (dryRun) {
        summary.copiados++;
        continue;
      }
      const { rowCount } = await support.query(
        `INSERT INTO mensaje_contacto (usu_id, men_nombre, men_correo, men_asunto, men_cuerpo, men_estado, men_correlation_id, men_creado_en, men_respondido_en)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
          WHERE NOT EXISTS (SELECT 1 FROM mensaje_contacto WHERE men_correlation_id = $7 AND men_correo = $3 AND men_creado_en = $8)`,
        [r.usu_id, nombre, r.email, r.asunto, r.mensaje, r.estado, r.correlation_id, r.creado_en, r.respondido_en],
      );
      if (rowCount) summary.copiados++;
      else summary.ya_migrados++;
    }
    if (!dryRun) await support.query('COMMIT');
  } catch (error) {
    if (!dryRun) await support.query('ROLLBACK');
    throw error;
  }

  if (!dryRun) {
    const count = async (client, sql) => Object.fromEntries((await client.query(sql)).rows.map((r) => [r.estado, r.total]));
    const before = await count(audit, `SELECT estado, count(*)::int AS total FROM mensaje_contacto GROUP BY estado`);
    const after = await count(support, `SELECT men_estado AS estado, count(*)::int AS total FROM mensaje_contacto GROUP BY men_estado`);
    for (const estado of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if ((before[estado] ?? 0) !== (after[estado] ?? 0)) {
        console.warn(`[diferencia] ${estado}: Audit ${before[estado] ?? 0}, ms_support ${after[estado] ?? 0}.`);
        process.exitCode = 1;
      }
    }
  }
  console.log(`${dryRun ? '[simulación] ' : ''}Resumen:`, summary);
} finally {
  await audit.end();
  await support.end();
}
