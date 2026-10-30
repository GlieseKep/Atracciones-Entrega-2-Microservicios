// Copia las tarifas de Inventory (inventory_db.schema_atracciones.tarifa + tarifa_precio) a ms_pricing.tarifa.
// Plan/ms_pricing/PLAN_IMPLEMENTACION.md, Fase 4.
//
// Uso:  npm run build && npm run db:migrate -- ms-pricing && node tools/migrate-tariffs-to-pricing.mjs [--dry-run]
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base (igual que tools/migrate-services.mjs).
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
//
// - Inventory guarda una cabecera por vigencia con un precio por tipo; Pricing, una fila por tipo y vigencia. Se
//   conservan vigente_desde, vigente_hasta y la moneda.
// - Idempotente: una fila que ya existe (misma atracción, tipo y vigente_desde) se salta.
// - Al terminar compara, por atracción, la tabla vigente hoy en las dos bases y lista las diferencias.
import pg from 'pg';

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
const dryRun = process.argv.includes('--dry-run');
const S = 'schema_atracciones';

const inventory = new pg.Client({ connectionString: `${base}inventory_db`, ssl });
const pricing = new pg.Client({ connectionString: `${base}ms_pricing`, ssl });
await inventory.connect();
await pricing.connect();

const summary = { filas: 0, ya_migradas: 0, con_error: 0, diferencias_hoy: 0 };
try {
  const { rows } = await inventory.query(
    `SELECT t.atraccion_codigo, p.tipo_boleto, p.precio, t.moneda, t.vigente_desde::text AS desde, t.vigente_hasta::text AS hasta
       FROM ${S}.tarifa t JOIN ${S}.tarifa_precio p ON p.tarifa_id = t.id
      ORDER BY t.atraccion_codigo, p.tipo_boleto, t.vigente_desde`,
  );
  for (const r of rows) {
    if (dryRun) {
      summary.filas++;
      continue;
    }
    try {
      const { rowCount } = await pricing.query(
        `INSERT INTO tarifa (atr_codigo, tar_tipo, tar_precio, tar_moneda, tar_vigente_desde, tar_vigente_hasta)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT uq_tarifa_atraccion_tipo_desde DO NOTHING`,
        [r.atraccion_codigo.trim(), r.tipo_boleto, r.precio, r.moneda, r.desde, r.hasta],
      );
      if (rowCount) summary.filas++;
      else summary.ya_migradas++;
    } catch (error) {
      // p. ej. 23P01: en ms_pricing ya hay otra versión que se cruza con esta vigencia.
      summary.con_error++;
      console.warn(`[error] ${r.atraccion_codigo.trim()} ${r.tipo_boleto} desde ${r.desde}: ${error.message}`);
    }
  }

  // Verificación: tabla vigente hoy, por atracción y tipo, en las dos bases.
  const today = (await pricing.query(`SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text AS d`)).rows[0].d;
  const current = async (client, sql) => new Map((await client.query(sql, [today])).rows.map((x) => [`${x.codigo.trim()}|${x.tipo}`, Number(x.precio)]));
  const before = await current(inventory,
    `SELECT t.atraccion_codigo AS codigo, p.tipo_boleto AS tipo, p.precio FROM ${S}.tarifa t JOIN ${S}.tarifa_precio p ON p.tarifa_id = t.id
      WHERE t.vigente_desde <= $1::date AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= $1::date)`);
  const after = await current(pricing,
    `SELECT atr_codigo AS codigo, tar_tipo AS tipo, tar_precio AS precio FROM tarifa
      WHERE tar_vigente_desde <= $1::date AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= $1::date)`);
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) {
      summary.diferencias_hoy++;
      console.warn(`[diferencia] ${key.replace('|', ' ')}: Inventory ${before.get(key) ?? '—'} · Pricing ${after.get(key) ?? '—'}`);
    }
  }
  console.log(`${dryRun ? '[simulación] ' : ''}Migración inventory_db → ms_pricing (hoy ${today}):`, summary);
} finally {
  await inventory.end();
  await pricing.end();
}
