// Copia los datos de facturación de Identity (identity_db.dato_facturacion) a ms_billing_profile.
// Plan/ms_billing_profile/PLAN_IMPLEMENTACION.md, Fase 4.
//
// Uso:  npm run build && npm run db:migrate -- ms-billing-profile && node tools/migrate-billing-to-profile.mjs [--dry-run]
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base (igual que tools/migrate-services.mjs).
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
//
// - usuario_id → usu_id, tipo_documento → dfa_tipo_identificacion, numero_documento en mayúsculas, email en minúsculas,
//   predeterminado → dfa_es_principal; se conservan creado_en y actualizado_en.
// - Las filas que no cumplen las restricciones nuevas (p. ej. razón social de más de 150 caracteres o correo que no pasa
//   dom_correo) se informan y no se copian: el usuario las vuelve a ingresar desde el portal.
// - Se puede repetir: un perfil que ya existe (mismo usuario, tipo y número) se salta, y no se marca un segundo principal.
import pg from 'pg';

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
const dryRun = process.argv.includes('--dry-run');

// Mismas reglas que los CHECK y dominios de ms_billing_profile.
const DOCUMENT = { CEDULA: /^[0-9]{10}$/, RUC: /^[0-9]{13}$/, PASAPORTE: /^[A-Z0-9]{6,20}$/ };
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[0-9]{7,15}$/;

function problems(row) {
  const found = [];
  if (!DOCUMENT[row.tipo]?.test(row.numero)) found.push(`documento ${row.tipo} '${row.numero}'`);
  if (row.razon_social.trim().length < 2 || row.razon_social.length > 150) found.push('razón social (2 a 150 caracteres)');
  if (row.email.length > 160 || !EMAIL.test(row.email)) found.push(`correo '${row.email}'`);
  if (row.telefono && !PHONE.test(row.telefono)) found.push(`teléfono '${row.telefono}'`);
  if (row.direccion && row.direccion.length > 300) found.push('dirección (más de 300 caracteres)');
  return found;
}

const connect = async (database) => {
  const client = new pg.Client({ connectionString: `${base}${database}`, ssl });
  await client.connect();
  return client;
};
const identity = await connect('identity_db');
const billing = await connect('ms_billing_profile');

const summary = { origen: 0, copiados: 0, ya_migrados: 0, omitidos: 0 };
try {
  const { rows } = await identity.query(
    `SELECT usuario_id::text AS usu_id, upper(tipo_documento) AS tipo, upper(btrim(numero_documento)) AS numero, btrim(razon_social) AS razon_social,
            lower(btrim(email)) AS email, nullif(btrim(telefono), '') AS telefono, nullif(btrim(direccion), '') AS direccion,
            predeterminado, creado_en, actualizado_en
       FROM dato_facturacion
      ORDER BY usuario_id, predeterminado DESC, creado_en`,
  );
  summary.origen = rows.length;

  if (!dryRun) await billing.query('BEGIN');
  try {
    for (const row of rows) {
      const found = problems(row);
      if (found.length) {
        summary.omitidos++;
        console.warn(`[omitido] usuario ${row.usu_id}: ${found.join(', ')}.`);
        continue;
      }
      if (dryRun) {
        summary.copiados++;
        continue;
      }
      // Principal solo si el usuario todavía no tiene uno (el script se puede repetir).
      const { rowCount } = await billing.query(
        `INSERT INTO dato_facturacion (usu_id, dfa_tipo_identificacion, dfa_identificacion, dfa_razon_social, dfa_correo, dfa_telefono,
           dfa_direccion, dfa_es_principal, dfa_creado_en, dfa_actualizado_en)
         SELECT $1, $2, $3, $4, $5, $6, $7,
                $8 AND NOT EXISTS (SELECT 1 FROM dato_facturacion WHERE usu_id = $1 AND dfa_es_principal), $9, $10
         ON CONFLICT ON CONSTRAINT uq_dato_facturacion_usuario_identificacion DO NOTHING`,
        [row.usu_id, row.tipo, row.numero, row.razon_social, row.email, row.telefono, row.direccion, row.predeterminado, row.creado_en, row.actualizado_en],
      );
      if (rowCount) summary.copiados++;
      else summary.ya_migrados++;
    }
    if (!dryRun) await billing.query('COMMIT');
  } catch (error) {
    if (!dryRun) await billing.query('ROLLBACK');
    throw error;
  }
  console.log(`${dryRun ? '[simulación] ' : ''}Resumen:`, summary);
} finally {
  await identity.end();
  await billing.end();
}
