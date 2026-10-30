// Migra el catálogo del monolito (base `tourgirls`, API v1) a las bases de los microservicios (plan §8, Fase 2):
//   - catalog_db: atracción (codigo_publico y slug nuevos), categoría, ciudad, fotos, idiomas, inclusiones, punto de encuentro.
//   - inventory_db: tarifa por tipo de boleto, horarios (uno por hora habitual) y turnos futuros con sus cupos reservados.
// Es idempotente: las atracciones que ya existen en catalog_db (mismo uuid) se omiten.
//
// No se migra la calificación: en v2 se calcula con reseñas individuales (3FN) y v1 solo guarda promedio y conteo.
// Los datos que v1 no tiene (itinerario, accesibilidad, banderas por categoría) quedan con valores por defecto.
//
// Uso: npm run build && node tools/migrate-v1-to-v2.mjs
//   V1_DATABASE_URL         (por defecto postgres://postgres:tourgirls-local@localhost:5433/tourgirls)
//   SERVICES_DATABASE_URL   servidor de las bases v2, sin nombre de base (por defecto el mismo PostgreSQL local)
//   STORE_OPERATOR_CODE     operador de la tienda (por defecto proveedor-atracciones-dilan)
//   TARIFA_NINO=0.5 TARIFA_SENIOR=0.6 TARIFA_ESTUDIANTE=0.75   fracción de la tarifa de adulto
import { createHash } from 'node:crypto';
import pg from 'pg';

const v1Url = process.env.V1_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/tourgirls';
const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const operatorCode = process.env.STORE_OPERATOR_CODE ?? 'proveedor-atracciones-dilan';
const factor = (name, fallback) => Number(process.env[name] ?? fallback);
const FACTORES = { CHILD: factor('TARIFA_NINO', 0.5), SENIOR: factor('TARIFA_SENIOR', 0.6), STUDENT: factor('TARIFA_ESTUDIANTE', 0.75) };
const S = 'schema_atracciones';

/** Categorías planas de v1 → árbol de v2 (catálogo inicial). Sin coincidencia: Tours y Experiencias Guiadas. */
const CATEGORIAS = { aventura: 'cat-tours-202', naturaleza: 'cat-naturaleza-300', cultura: 'cat-cultura-200', 'gastronomía': 'cat-tours-201', gastronomia: 'cat-tours-201', 'fotografía': 'cat-tours-203', fotografia: 'cat-tours-203' };
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Código público estable a partir del uuid de v1 (la migración se puede repetir sin cambiar los códigos). */
const publicCode = (uuid) => Array.from(createHash('sha256').update(uuid).digest().subarray(0, 12), (b) => BASE62[b % 62]).join('');
const slugify = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
const money = (v) => Math.round(v * 100) / 100;

/** `PT2H30M` → 2.5; `P1D` → 8 (jornada). */
function hours(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso ?? '');
  if (!m) return 2;
  const h = Number(m[1] ?? 0) * 8 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60;
  return h > 0 ? Math.round(h * 10) / 10 : 2;
}

const v1 = new pg.Client({ connectionString: v1Url });
const catalog = new pg.Client({ connectionString: `${base}catalog_db` });
const inventory = new pg.Client({ connectionString: `${base}inventory_db` });
await Promise.all([v1.connect(), catalog.connect(), inventory.connect()]);

try {
  const [{ rows: [operador] }, { rows: [hoy] }] = await Promise.all([
    catalog.query(`SELECT id FROM operador WHERE codigo = $1`, [operatorCode]),
    catalog.query(`SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text AS fecha`),
  ]);
  if (!operador) throw new Error(`El operador ${operatorCode} no existe en catalog_db (arranque Catalog una vez para cargar el catálogo inicial).`);

  const { rows: atracciones } = await v1.query(`SELECT id, name, long_description, duration, price_currency, price_amount, free_cancellation FROM attractions ORDER BY name`);
  let migradas = 0;
  for (const a of atracciones) {
    const { rowCount: existe } = await catalog.query(`SELECT 1 FROM atraccion WHERE id = $1`, [a.id]);
    if (existe) continue;

    const [{ rows: locs }, { rows: fotos }, { rows: cats }, { rows: incs }, { rows: langs }, { rows: turnos }] = await Promise.all([
      v1.query(`SELECT address, city, latitude, longitude FROM locations WHERE attraction_id = $1 ORDER BY position`, [a.id]),
      v1.query(`SELECT url FROM photos WHERE attraction_id = $1 ORDER BY position`, [a.id]),
      v1.query(`SELECT c.name FROM attraction_categories ac JOIN categories c ON c.id = ac.category_id WHERE ac.attraction_id = $1 ORDER BY c.name`, [a.id]),
      v1.query(`SELECT i.name FROM attraction_includes ai JOIN includes i ON i.id = ai.inclusion_id WHERE ai.attraction_id = $1 ORDER BY i.name`, [a.id]),
      v1.query(`SELECT l.name FROM attraction_languages al JOIN supported_languages l ON l.id = al.language_id WHERE al.attraction_id = $1`, [a.id]),
      v1.query(`SELECT date::text AS fecha, time::text AS hora, capacity, reserved_quantity FROM attraction_availability WHERE attraction_id = $1 AND date >= $2::date ORDER BY date, time`, [a.id, hoy.fecha]),
    ]);
    const loc = locs.find((l) => l.latitude !== null && l.longitude !== null);
    if (!loc) {
      console.warn(`[omitida] ${a.name}: sin ubicación con coordenadas (el punto de encuentro del contrato las exige).`);
      continue;
    }
    const codigo = publicCode(a.id);
    const includes = incs.map((i) => i.name);
    const has = (...words) => includes.some((n) => words.some((w) => n.toLowerCase().includes(w)));
    const categoria = cats.map((c) => CATEGORIAS[c.name.toLowerCase()]).find(Boolean) ?? 'cat-tours-100';

    await catalog.query('BEGIN');
    try {
      let { rows: [ciudad] } = await catalog.query(`SELECT id FROM ciudad WHERE lower(f_unaccent(nombre)) = lower(f_unaccent($1))`, [loc.city]);
      if (!ciudad) {
        const { rows: [region] } = await catalog.query(`INSERT INTO region (nombre) VALUES ('Sin asignar') ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`);
        const { rows: [provincia] } = await catalog.query(
          `INSERT INTO provincia (region_id, nombre) VALUES ($1, 'Sin asignar') ON CONFLICT ON CONSTRAINT uq_provincia_nombre DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`, [region.id]);
        ({ rows: [ciudad] } = await catalog.query(`INSERT INTO ciudad (provincia_id, nombre) VALUES ($1, $2) RETURNING id`, [provincia.id, loc.city]));
      }
      const corta = (a.long_description.split(/(?<=\.)\s/)[0] ?? a.long_description).slice(0, 300);
      await catalog.query(
        `INSERT INTO atraccion (id, codigo_publico, slug, nombre, descripcion_corta, descripcion, categoria_id, operador_id, ciudad_id, duracion_horas,
                                incluye_comida, incluye_transporte, incluye_guia, pe_direccion, pe_latitud, pe_longitud,
                                cancelacion_gratuita, cancelacion_horas_limite, permite_paquete, precio_desde_adulto)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM categoria WHERE codigo = $7), $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 24, true, $18)`,
        [a.id, codigo, `${slugify(a.name)}-${codigo.toLowerCase()}`, a.name.slice(0, 200), corta, a.long_description, categoria, operador.id, ciudad.id, hours(a.duration),
          has('almuerzo', 'comida', 'degust', 'cena'), has('transporte', 'traslado'), has('guía', 'guia'),
          loc.address, loc.latitude, loc.longitude, a.free_cancellation, a.price_amount],
      );
      for (const [i, texto] of includes.entries()) {
        await catalog.query(`INSERT INTO inclusion (atraccion_id, tipo, descripcion, orden) VALUES ($1, 'INCLUYE', $2, $3)`, [a.id, texto, i + 1]);
      }
      for (const [i, foto] of fotos.entries()) {
        const { rows: [f] } = await catalog.query(`INSERT INTO foto (url) VALUES ($1) ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url RETURNING id`, [foto.url]);
        await catalog.query(`INSERT INTO atraccion_foto (atraccion_id, foto_id, orden) VALUES ($1, $2, $3)`, [a.id, f.id, i + 1]);
      }
      for (const lang of langs) {
        await catalog.query(
          `INSERT INTO atraccion_idioma (atraccion_id, idioma_id) SELECT $1, id FROM idioma WHERE codigo_iso = lower($2) OR lower(nombre) = lower($2) ON CONFLICT DO NOTHING`,
          [a.id, lang.name],
        );
      }
      await catalog.query('COMMIT');
    } catch (error) {
      await catalog.query('ROLLBACK');
      throw error;
    }

    await inventory.query('BEGIN');
    try {
      const adulto = Number(a.price_amount);
      const { rows: [tarifa] } = await inventory.query(
        `INSERT INTO ${S}.tarifa (atraccion_codigo, moneda, vigente_desde) VALUES ($1, $2, $3) RETURNING id`, [codigo, a.price_currency, hoy.fecha]);
      const precios = [['ADULT', adulto], ['CHILD', adulto * FACTORES.CHILD], ['SENIOR', adulto * FACTORES.SENIOR], ['STUDENT', adulto * FACTORES.STUDENT], ['INFANT', 0]];
      for (const [tipo, precio] of precios) {
        await inventory.query(`INSERT INTO ${S}.tarifa_precio (tarifa_id, tipo_boleto, precio) VALUES ($1, $2, $3)`, [tarifa.id, tipo, money(precio)]);
      }
      // Un horario semanal por cada hora habitual (con su capacidad más frecuente) para seguir generando turnos.
      const porHora = new Map();
      for (const t of turnos) porHora.set(t.hora, [...(porHora.get(t.hora) ?? []), t.capacity]);
      for (const [hora, capacidades] of porHora) {
        const capacidad = capacidades.sort((x, y) => capacidades.filter((c) => c === y).length - capacidades.filter((c) => c === x).length)[0];
        for (let dia = 1; dia <= 7; dia++) {
          await inventory.query(
            `INSERT INTO ${S}.horario (atraccion_codigo, dia_semana, hora_inicio, capacidad, vigente_desde) VALUES ($1, $2, $3, $4, $5)`,
            [codigo, dia, hora, capacidad, hoy.fecha],
          );
        }
      }
      for (const t of turnos) {
        await inventory.query(
          `INSERT INTO ${S}.turnos_aforo (atraccion_codigo, fecha, hora, cupos_totales, cupos_reservados) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ON CONSTRAINT uq_turnos_aforo_turno DO NOTHING`,
          [codigo, t.fecha, t.hora, t.capacity, Math.min(t.reserved_quantity, t.capacity)],
        );
      }
      await inventory.query('COMMIT');
    } catch (error) {
      await inventory.query('ROLLBACK');
      throw error;
    }
    migradas++;
    console.log(`[migrada] ${a.name} → ${codigo} (${turnos.length} turnos futuros)`);
  }
  console.log(`Listo: ${migradas} atracciones migradas, ${atracciones.length - migradas} ya existían u omitidas.`);
  if (migradas > 0) await catalog.query(`REFRESH MATERIALIZED VIEW v_atraccion_calificacion`);
} finally {
  await Promise.all([v1.end(), catalog.end(), inventory.end()]);
}
