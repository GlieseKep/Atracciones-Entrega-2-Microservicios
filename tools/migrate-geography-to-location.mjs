// Mapa de ciudades de Catalog (catalog_db.ciudad) a Location (ms_location.ciudad) y reescritura de los IDs que ya
// guardan otros servicios. Plan/ms_location/PLAN_IMPLEMENTACION.md, Fase 4.
//
// Uso:  npm run build && npm run db:migrate -- ms-location && node tools/migrate-geography-to-location.mjs [--coupon]
//
//   sin opciones  Solo arma y muestra el mapa. Falla (código 1) si alguna ciudad de Catalog no existe en Location:
//                 hay que agregarla a la carga inicial (1795000000100-InitialGeography.ts) antes de seguir.
//   --coupon      Además reescribe ms_coupon.acuerdo_promocion_destino.ciu_id (hoy guarda IDs de Catalog). Ejecutarlo
//                 UNA sola vez, en el mismo corte en que Coupon pasa a resolver destinos con Location: si se repite,
//                 los IDs ya traducidos se volverían a traducir.
//
// La reescritura de atraccion.ciudad_id en Catalog se agrega aquí cuando Catalog tenga su tabla ciudad_proyeccion
// (Fase 3 del plan); hoy esa columna todavía tiene FK a la ciudad de Catalog.
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base (igual que tools/migrate-services.mjs).
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
import pg from 'pg';

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
const rewriteCoupon = process.argv.includes('--coupon');

const connect = async (database) => {
  const client = new pg.Client({ connectionString: `${base}${database}`, ssl });
  await client.connect();
  return client;
};
const catalog = await connect('catalog_db');
const location = await connect('ms_location');
const coupon = rewriteCoupon ? await connect('ms_coupon') : null;

try {
  // --- Mapa catalog.ciudad.id → ms_location.ciu_id (mismo nombre y misma provincia, sin tildes ni mayúsculas) -------
  const { rows: cities } = await catalog.query(
    `SELECT ci.id, ci.nombre, p.nombre AS provincia FROM ciudad ci JOIN provincia p ON p.id = ci.provincia_id ORDER BY ci.id`,
  );
  const map = new Map();
  const missing = [];
  for (const city of cities) {
    const { rows: [found] } = await location.query(
      `SELECT c.ciu_id FROM ciudad c JOIN provincia p ON p.prov_id = c.prov_id
        WHERE lower(f_unaccent(c.ciu_nombre)) = lower(f_unaccent($1)) AND lower(f_unaccent(p.prov_nombre)) = lower(f_unaccent($2))`,
      [city.nombre.trim(), city.provincia.trim()],
    );
    if (found) {
      map.set(city.id, found.ciu_id);
      console.log(`[ok] ${city.nombre} (${city.provincia}): catalog ${city.id} → location ${found.ciu_id}`);
    } else {
      missing.push(city);
    }
  }
  if (missing.length) {
    for (const city of missing) console.error(`[falta] ${city.nombre} (${city.provincia}, catalog ${city.id}) no existe en ms_location.`);
    console.error('Agregue esas ciudades a la carga inicial de ms-location y repita. No se modificó nada.');
    process.exitCode = 1;
  } else if (coupon) {
    // --- ms_coupon: destinos del acuerdo B2B --------------------------------------------------------------------
    await coupon.query('BEGIN');
    try {
      const { rows: destinations } = await coupon.query(`SELECT apr_id, ciu_id FROM acuerdo_promocion_destino ORDER BY apr_id, ciu_id`);
      const unknown = destinations.filter((d) => !map.has(d.ciu_id));
      for (const d of unknown) console.warn(`[omitido] destino ciu_id ${d.ciu_id} del acuerdo ${d.apr_id}: no es una ciudad de Catalog; se elimina.`);
      // Se borran y se vuelven a insertar: actualizar en el lugar podría chocar con la clave (apr_id, ciu_id).
      await coupon.query(`DELETE FROM acuerdo_promocion_destino`);
      const mapped = destinations.filter((d) => map.has(d.ciu_id));
      for (const d of mapped) {
        await coupon.query(
          `INSERT INTO acuerdo_promocion_destino (apr_id, ciu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [d.apr_id, map.get(d.ciu_id)],
        );
      }
      await coupon.query('COMMIT');
      console.log(`[ms_coupon] ${mapped.length} destinos reescritos con IDs de Location, ${unknown.length} eliminados.`);
    } catch (error) {
      await coupon.query('ROLLBACK');
      throw error;
    }
  }
  console.log(`Resumen: ${cities.length} ciudades en Catalog, ${map.size} encontradas en Location, ${missing.length} faltantes.`);
} finally {
  await catalog.end();
  await location.end();
  await coupon?.end();
}
