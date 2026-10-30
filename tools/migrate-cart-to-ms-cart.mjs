// Copia los carritos activos de cart_db (Cart actual) a ms_cart (Cart del diseño v2). Plan/ms_cart/PLAN_IMPLEMENTACION.md, Fase 4.
//
// Uso:  npm run build && npm run db:migrate -- ms-cart && node tools/migrate-cart-to-ms-cart.mjs [--dry-run]
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base (igual que tools/migrate-services.mjs).
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
//
// - Solo copia carritos ACTIVO; los CONVERTIDO y ABANDONADO no tienen valor para el usuario. Los favoritos no se copian.
// - Cada ítem llega PENDIENTE, con slot_id = slot-YYYYMMDD-HHmm y una columna por tipo de boleto.
// - Un ítem sin boletos ADULT no cumple la regla del contrato: se informa y no se copia.
// - Idempotente: un usuario que ya tiene carrito activo en ms_cart se salta.
import pg from 'pg';

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
const dryRun = process.argv.includes('--dry-run');

const source = new pg.Client({ connectionString: `${base}cart_db`, ssl });
const target = new pg.Client({ connectionString: `${base}ms_cart`, ssl });
await source.connect();
await target.connect();

const summary = { carritos: 0, items: 0, saltados_ya_migrados: 0, items_sin_adulto: 0 };
try {
  const { rows: carts } = await source.query(
    `SELECT id, usuario_id::text AS usuario_id, creado_en, actualizado_en FROM carrito WHERE estado = 'ACTIVO' ORDER BY creado_en`,
  );
  for (const cart of carts) {
    const { rowCount } = await target.query('SELECT 1 FROM carrito WHERE usu_id = $1 AND car_activo', [cart.usuario_id]);
    if (rowCount > 0) {
      summary.saltados_ya_migrados++;
      continue;
    }
    const { rows: items } = await source.query(
      `SELECT i.id, i.atraccion_codigo, 'slot-' || to_char(i.fecha, 'YYYYMMDD') || '-' || to_char(i.hora, 'HH24MI') AS slot, i.agregado_en,
              coalesce(sum(b.cantidad) FILTER (WHERE b.tipo_boleto = 'ADULT'), 0)::int   AS adultos,
              coalesce(sum(b.cantidad) FILTER (WHERE b.tipo_boleto = 'CHILD'), 0)::int   AS ninos,
              coalesce(sum(b.cantidad) FILTER (WHERE b.tipo_boleto = 'SENIOR'), 0)::int  AS seniors,
              coalesce(sum(b.cantidad) FILTER (WHERE b.tipo_boleto = 'STUDENT'), 0)::int AS estudiantes,
              coalesce(sum(b.cantidad) FILTER (WHERE b.tipo_boleto = 'INFANT'), 0)::int  AS infantes
         FROM carrito_item i LEFT JOIN carrito_item_boleto b ON b.carrito_item_id = i.id
        WHERE i.carrito_id = $1
        GROUP BY i.id ORDER BY i.agregado_en, i.id`,
      [cart.id],
    );
    const valid = items.filter((i) => {
      if (i.adultos >= 1) return true;
      summary.items_sin_adulto++;
      console.warn(`[omitido] ítem ${i.id} del carrito ${cart.id}: no tiene boletos ADULT.`);
      return false;
    });
    if (dryRun) {
      summary.carritos++;
      summary.items += valid.length;
      continue;
    }
    await target.query('BEGIN');
    try {
      const { rows: [created] } = await target.query(
        `INSERT INTO carrito (usu_id, car_creado_en, car_actualizado_en) VALUES ($1, $2, $3) RETURNING car_id`,
        [cart.usuario_id, cart.creado_en, cart.actualizado_en],
      );
      for (const i of valid) {
        await target.query(
          `INSERT INTO carrito_item (car_id, atr_codigo, dis_slot_codigo, cai_adultos, cai_ninos, cai_seniors, cai_estudiantes, cai_infantes, cai_creado_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [created.car_id, i.atraccion_codigo.trim(), i.slot, i.adultos, i.ninos, i.seniors, i.estudiantes, i.infantes, i.agregado_en],
        );
      }
      await target.query('COMMIT');
      summary.carritos++;
      summary.items += valid.length;
    } catch (error) {
      await target.query('ROLLBACK');
      throw error;
    }
  }
  console.log(`${dryRun ? '[simulación] ' : ''}Migración cart_db → ms_cart:`, summary);
} finally {
  await source.end();
  await target.end();
}
