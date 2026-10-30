// Copia a ms_coupon el acuerdo B2B de promociones (hoy en catalog_db) y los cupones (hoy en order_db).
// Plan/ms_coupon/PLAN_IMPLEMENTACION.md, Fase 4.
//
// Uso:  npm run build && npm run db:migrate -- ms-coupon && node tools/migrate-promotions-to-coupon.mjs [--dry-run]
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base (igual que tools/migrate-services.mjs).
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
// COUPON_PROVIDER_ID: proveedor_id del acuerdo (por defecto proveedor-atracciones-dilan).
//
// - Acuerdo: Catalog guarda uno por operador; el contrato v3 responde uno solo. Se copia el más reciente
//   (actualizado_en) y se listan los descartados. Los destinos (texto) se resuelven a ciudades de Catalog sin
//   distinguir tildes ni mayúsculas; los que no existen se informan y no se copian.
// - Cupones: código en mayúsculas, MONTO → FIJO; se conservan fechas, usos máximos y estado. Un código que ya existe
//   en ms_coupon se salta (el script se puede repetir).
import pg from 'pg';

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
const provider = process.env.COUPON_PROVIDER_ID ?? 'proveedor-atracciones-dilan';
const dryRun = process.argv.includes('--dry-run');

const connect = async (database) => {
  const client = new pg.Client({ connectionString: `${base}${database}`, ssl });
  await client.connect();
  return client;
};
const catalog = await connect('catalog_db');
const order = await connect('order_db');
const coupon = await connect('ms_coupon');

const summary = { acuerdo: 'sin acuerdo en Catalog', acuerdos_descartados: 0, destinos: 0, destinos_sin_ciudad: 0, cupones: 0, cupones_ya_migrados: 0 };
try {
  // --- Acuerdo B2B ---------------------------------------------------------------------------------------------
  const { rows: agreements } = await catalog.query(
    `SELECT ap.id, o.codigo AS operador, o.nombre_comercial, ap.permite_promociones, ap.porcentaje_descuento_maximo,
            ap.fecha_acuerdo::text AS fecha_acuerdo, ap.vigencia_hasta::text AS vigencia_hasta, ap.condiciones_combo,
            ap.contacto_nombre, ap.contacto_email, ap.contacto_telefono
       FROM acuerdo_promocion ap JOIN operador o ON o.id = ap.operador_id
      ORDER BY ap.actualizado_en DESC`,
  );
  if (agreements.length) {
    const [chosen, ...discarded] = agreements;
    for (const d of discarded) console.warn(`[descartado] acuerdo del operador ${d.operador} (se conserva el de ${chosen.operador}, el más reciente).`);
    summary.acuerdos_descartados = discarded.length;

    const { rows: destinations } = await catalog.query(`SELECT destino FROM acuerdo_promocion_destino WHERE acuerdo_id = $1 ORDER BY destino`, [chosen.id]);
    const cityIds = new Set();
    for (const { destino } of destinations) {
      const { rows: [city] } = await catalog.query(
        `SELECT id FROM ciudad WHERE lower(f_unaccent(nombre)) = lower(f_unaccent($1)) ORDER BY id LIMIT 1`,
        [destino.trim()],
      );
      if (city) cityIds.add(city.id);
      else {
        summary.destinos_sin_ciudad++;
        console.warn(`[omitido] destino '${destino}': no es una ciudad del catálogo. Corríjalo después con PUT /atracciones/promociones/contrato.`);
      }
    }
    summary.destinos = cityIds.size;
    summary.acuerdo = `operador ${chosen.operador} → ${provider}`;

    if (!dryRun) {
      await coupon.query('BEGIN');
      try {
        const { rows: [saved] } = await coupon.query(
          `INSERT INTO acuerdo_promocion (apr_proveedor_codigo, apr_nombre_comercial, apr_permite_promociones, apr_porcentaje_descuento_max,
             apr_fecha_acuerdo, apr_vigencia_hasta, apr_condiciones_combo, apr_contacto_nombre, apr_contacto_correo, apr_contacto_telefono)
           VALUES ($1, $2, $3, $4, $5, $6, left($7, 500), left($8, 120), $9, $10)
           ON CONFLICT ON CONSTRAINT uq_acuerdo_promocion_proveedor DO UPDATE SET
             apr_nombre_comercial = EXCLUDED.apr_nombre_comercial, apr_permite_promociones = EXCLUDED.apr_permite_promociones,
             apr_porcentaje_descuento_max = EXCLUDED.apr_porcentaje_descuento_max, apr_fecha_acuerdo = EXCLUDED.apr_fecha_acuerdo,
             apr_vigencia_hasta = EXCLUDED.apr_vigencia_hasta, apr_condiciones_combo = EXCLUDED.apr_condiciones_combo,
             apr_contacto_nombre = EXCLUDED.apr_contacto_nombre, apr_contacto_correo = EXCLUDED.apr_contacto_correo,
             apr_contacto_telefono = EXCLUDED.apr_contacto_telefono
           RETURNING apr_id`,
          [provider, chosen.nombre_comercial, chosen.permite_promociones, chosen.porcentaje_descuento_maximo, chosen.fecha_acuerdo,
            chosen.vigencia_hasta, chosen.condiciones_combo, chosen.contacto_nombre, chosen.contacto_email, chosen.contacto_telefono],
        );
        await coupon.query(`DELETE FROM acuerdo_promocion_destino WHERE apr_id = $1`, [saved.apr_id]);
        if (cityIds.size) {
          await coupon.query(`INSERT INTO acuerdo_promocion_destino (apr_id, ciu_id) SELECT $1, unnest($2::smallint[])`, [saved.apr_id, [...cityIds]]);
        }
        await coupon.query('COMMIT');
      } catch (error) {
        await coupon.query('ROLLBACK');
        throw error;
      }
    }
  }

  // --- Cupones -------------------------------------------------------------------------------------------------
  const { rows: coupons } = await order.query(
    `SELECT upper(codigo) AS codigo, CASE tipo WHEN 'MONTO' THEN 'FIJO' ELSE tipo END AS tipo, valor,
            vigente_desde::text AS desde, vigente_hasta::text AS hasta, usos_maximos, activo
       FROM cupon ORDER BY codigo`,
  );
  for (const c of coupons) {
    if (dryRun) {
      summary.cupones++;
      continue;
    }
    const { rowCount } = await coupon.query(
      `INSERT INTO cupon (cup_codigo, cup_tipo, cup_valor, cup_fecha_inicio, cup_fecha_fin, cup_usos_max, cup_activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT ON CONSTRAINT uq_cupon_codigo DO NOTHING`,
      [c.codigo, c.tipo, c.valor, c.desde, c.hasta, c.usos_maximos, c.activo],
    );
    if (rowCount) summary.cupones++;
    else summary.cupones_ya_migrados++;
  }

  console.log(`${dryRun ? '[simulación] ' : ''}Migración a ms_coupon:`, summary);
} finally {
  await Promise.all([catalog.end(), order.end(), coupon.end()]);
}
