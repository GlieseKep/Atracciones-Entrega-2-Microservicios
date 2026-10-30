import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeTime } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';

interface SeedCategory {
  codigo: string;
  nombre: string;
  slug: string;
  descripcion: string;
  icono: string;
  orden: number;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
  subcategorias: SeedCategory[];
}

/** Parte del catálogo inicial v2 que le corresponde a Catalog. */
interface CatalogSeed {
  operador: { codigo: string; nombre_comercial: string; ruc: string; telefono_emergencia: string; email_soporte: string };
  acuerdo_promocion: {
    permite_promociones: boolean;
    porcentaje_descuento_maximo: number;
    destinos_habilitados: string[];
    fecha_acuerdo: string;
    vigencia_hasta: string;
    condiciones_combo: string;
    contacto: { nombre: string; email: string; telefono: string };
  };
  regiones: { nombre: string; provincias: { nombre: string; ciudades: string[] }[] }[];
  idiomas: { nombre: string; codigo_iso: string }[];
  categorias: SeedCategory[];
  atracciones: {
    codigo_publico: string;
    uuid: string;
    slug: string;
    nombre: string;
    descripcion_corta: string;
    descripcion: string;
    categoria: string;
    ciudad: string;
    duracion_horas: number;
    incluye_comida: boolean;
    incluye_transporte: boolean;
    incluye_guia: boolean;
    punto_encuentro: { direccion: string; latitud: number; longitud: number; instrucciones?: string };
    accesibilidad: { silla_ruedas: boolean; carriola: boolean; animales_asistencia: boolean };
    cancelacion: { gratuita: boolean; horas_limite: number; descripcion: string };
    permite_paquete: boolean;
    idiomas: string[];
    inclusiones: string[];
    exclusiones: string[];
    fotos: string[];
    itinerario: { hora: string; titulo: string; descripcion: string; duracion_minutos: number; ubicacion: string }[];
    resenas: { puntuacion: number; limpieza: number; servicio: number; calidad_precio: number; puntualidad: number; cantidad: number };
    tarifa: { adulto: number };
  }[];
}

export const seedFile = () => process.env.SEED_CATALOG_FILE ?? resolve(__dirname, '..', '..', '..', 'seed', 'catalogo-v2.json');

/**
 * Notas de reseña alrededor del promedio: pares ±0,1 (y un 0 si la cantidad es impar), para que el promedio de la vista
 * materializada coincida con el del catálogo.
 */
function spread(average: number, count: number): number[] {
  const values: number[] = count % 2 === 1 ? [average] : [];
  while (values.length < count) values.push(Math.min(10, average + 0.1), Math.max(1, average - 0.1));
  return values.map((v) => Math.round(v * 10) / 10);
}

async function insertCategory(m: EntityManager, c: SeedCategory, padreId: number | null): Promise<void> {
  const [row] = await m.query(
    `INSERT INTO categoria (codigo, padre_id, nombre, slug, descripcion, icono, orden, incluye_comida, incluye_transporte, incluye_guia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [c.codigo, padreId, c.nombre, c.slug, c.descripcion, c.icono, c.orden, c.incluye_comida, c.incluye_transporte, c.incluye_guia],
  );
  for (const hija of c.subcategorias) await insertCategory(m, hija, row.id);
}

/** Carga el catálogo inicial si la base está vacía (idempotente: no toca un catálogo existente). */
export async function seedCatalog(dataSource: DataSource, file = seedFile()): Promise<number> {
  const [{ n }] = await dataSource.query(`SELECT count(*)::int AS n FROM atraccion`);
  if (n > 0) return 0;
  const seed = JSON.parse(readFileSync(file, 'utf8')) as CatalogSeed;
  await dataSource.transaction(async (m) => {
    const o = seed.operador;
    const [operador] = await m.query(
      `INSERT INTO operador (codigo, nombre_comercial, ruc, telefono_emergencia, email_soporte) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [o.codigo, o.nombre_comercial, o.ruc, o.telefono_emergencia, o.email_soporte],
    );
    const ac = seed.acuerdo_promocion;
    const [acuerdo] = await m.query(
      `INSERT INTO acuerdo_promocion (operador_id, permite_promociones, porcentaje_descuento_maximo, fecha_acuerdo, vigencia_hasta, condiciones_combo,
                                      contacto_nombre, contacto_email, contacto_telefono)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [operador.id, ac.permite_promociones, ac.porcentaje_descuento_maximo, ac.fecha_acuerdo, ac.vigencia_hasta, ac.condiciones_combo, ac.contacto.nombre, ac.contacto.email, ac.contacto.telefono],
    );
    for (const destino of ac.destinos_habilitados) {
      await m.query(`INSERT INTO acuerdo_promocion_destino (acuerdo_id, destino) VALUES ($1, $2)`, [acuerdo.id, destino]);
    }

    const ciudades = new Map<string, number>();
    for (const r of seed.regiones) {
      const [region] = await m.query(`INSERT INTO region (nombre) VALUES ($1) RETURNING id`, [r.nombre]);
      for (const p of r.provincias) {
        const [provincia] = await m.query(`INSERT INTO provincia (region_id, nombre) VALUES ($1, $2) RETURNING id`, [region.id, p.nombre]);
        for (const c of p.ciudades) {
          const [ciudad] = await m.query(`INSERT INTO ciudad (provincia_id, nombre) VALUES ($1, $2) RETURNING id`, [provincia.id, c]);
          ciudades.set(c, ciudad.id);
        }
      }
    }
    const idiomas = new Map<string, number>();
    for (const i of seed.idiomas) {
      const [row] = await m.query(`INSERT INTO idioma (nombre, codigo_iso) VALUES ($1, $2) RETURNING id`, [i.nombre, i.codigo_iso]);
      idiomas.set(i.codigo_iso, row.id);
    }
    for (const c of seed.categorias) await insertCategory(m, c, null);

    for (const a of seed.atracciones) {
      const ciudad = ciudades.get(a.ciudad);
      if (!ciudad) throw new Error(`El catálogo inicial no define la ciudad ${a.ciudad}.`);
      const pe = a.punto_encuentro;
      await m.query(
        `INSERT INTO atraccion (id, codigo_publico, slug, nombre, descripcion_corta, descripcion, categoria_id, operador_id, ciudad_id, duracion_horas,
                                incluye_comida, incluye_transporte, incluye_guia, pe_direccion, pe_latitud, pe_longitud, pe_instrucciones,
                                accesible_silla_ruedas, accesible_carriola, admite_animales_asistencia,
                                cancelacion_gratuita, cancelacion_horas_limite, cancelacion_descripcion, permite_paquete, precio_desde_adulto, popularidad)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM categoria WHERE codigo = $7), $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [a.uuid, a.codigo_publico, a.slug, a.nombre, a.descripcion_corta, a.descripcion, a.categoria, operador.id, ciudad, a.duracion_horas,
          a.incluye_comida, a.incluye_transporte, a.incluye_guia, pe.direccion, pe.latitud, pe.longitud, pe.instrucciones ?? null,
          a.accesibilidad.silla_ruedas, a.accesibilidad.carriola, a.accesibilidad.animales_asistencia,
          a.cancelacion.gratuita, a.cancelacion.horas_limite, a.cancelacion.descripcion, a.permite_paquete, a.tarifa.adulto, a.resenas.cantidad * 100],
      );
      for (const iso of a.idiomas) await m.query(`INSERT INTO atraccion_idioma (atraccion_id, idioma_id) VALUES ($1, $2)`, [a.uuid, idiomas.get(iso)]);
      for (const [i, texto] of a.inclusiones.entries()) await m.query(`INSERT INTO inclusion (atraccion_id, tipo, descripcion, orden) VALUES ($1, 'INCLUYE', $2, $3)`, [a.uuid, texto, i + 1]);
      for (const [i, texto] of a.exclusiones.entries()) await m.query(`INSERT INTO inclusion (atraccion_id, tipo, descripcion, orden) VALUES ($1, 'EXCLUYE', $2, $3)`, [a.uuid, texto, i + 1]);
      for (const [i, url] of a.fotos.entries()) {
        const [foto] = await m.query(`INSERT INTO foto (url) VALUES ($1) ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url RETURNING id`, [url]);
        await m.query(`INSERT INTO atraccion_foto (atraccion_id, foto_id, orden) VALUES ($1, $2, $3)`, [a.uuid, foto.id, i + 1]);
      }
      for (const [i, p] of a.itinerario.entries()) {
        await m.query(
          `INSERT INTO itinerario_parada (atraccion_id, numero_parada, hora, titulo, descripcion, duracion_minutos, nombre_ubicacion) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [a.uuid, i + 1, normalizeTime(p.hora), p.titulo, p.descripcion, p.duracion_minutos, p.ubicacion],
        );
      }
      const r = a.resenas;
      const [general, limpieza, servicio, calidad, puntualidad] = [r.puntuacion, r.limpieza, r.servicio, r.calidad_precio, r.puntualidad].map((v) => spread(v, r.cantidad));
      for (let i = 0; i < r.cantidad; i++) {
        await m.query(
          `INSERT INTO resena (reserva_id, atraccion_id, usuario_id, puntuacion_general, limpieza, servicio, calidad_precio, puntualidad, comentario)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), a.uuid, randomUUID(), general[i], limpieza[i], servicio[i], calidad[i], puntualidad[i], 'Reseña del catálogo inicial.'],
        );
      }
    }
  });
  await dataSource.query(`REFRESH MATERIALIZED VIEW v_atraccion_calificacion`);
  return seed.atracciones.length;
}
