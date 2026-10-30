import { randomBytes } from 'node:crypto';
import { recordEvent, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';

/** Datos editables de una atracción (el `codigo_publico` es inmutable y lo genera el servicio). */
export interface AttractionInput {
  nombre: string;
  descripcion_corta: string;
  descripcion: string;
  categoria_codigo: string;
  ciudad_id: number;
  operador_codigo: string;
  duracion_horas: number;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
  punto_encuentro: { direccion: string; latitud: number; longitud: number; instrucciones: string | null; google_maps_url: string | null };
  accesible_silla_ruedas: boolean;
  accesible_carriola: boolean;
  admite_animales_asistencia: boolean;
  cancelacion: { gratuita: boolean; horas_limite: number; descripcion: string | null };
  permite_paquete: boolean;
  idiomas: string[];
  inclusiones: string[];
  exclusiones: string[];
  fotos: string[];
  itinerario: { hora: string; titulo: string; descripcion: string | null; duracion_minutos: number; nombre_ubicacion: string | null }[];
}

export interface AdminAttractionRow {
  uuid: string;
  codigo_publico: string;
  slug: string;
  nombre: string;
  ciudad: string;
  categoria_codigo: string;
  categoria: string;
  activa: boolean;
  popularidad: number;
  precio_desde_adulto: number | null;
  foto: string | null;
  actualizado_en: string;
}

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Código público de 12 caracteres alfanuméricos, como los del contrato (`PRhu4UBTWPBC`). */
export const newPublicCode = () => Array.from(randomBytes(12), (b) => ALPHANUMERIC[b % ALPHANUMERIC.length]).join('');

/** Rutas del contrato que no pueden usarse como slug (`/atracciones/{slug}` chocaría con ellas). */
export const RESERVED_SLUGS = ['search', 'categorias', 'reservas', 'promociones', 'eventos', 'health'];

export function slugify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150) || 'atraccion';
}

/** Escrituras del catálogo desde la administración del portal (GraphQL). */
export class CatalogAdminRepository {
  constructor(private readonly db: DataSource) {}

  async references() {
    const [ciudades, categorias, operadores, idiomas] = await Promise.all([
      this.db.query(`SELECT ci.id, ci.nombre, p.nombre AS provincia FROM ciudad ci JOIN provincia p ON p.id = ci.provincia_id ORDER BY ci.nombre`),
      this.db.query(
        `SELECT c.codigo, c.nombre, p.codigo AS padre_codigo, c.incluye_comida, c.incluye_transporte, c.incluye_guia
           FROM categoria c LEFT JOIN categoria p ON p.id = c.padre_id WHERE c.activa ORDER BY c.orden, c.nombre`,
      ),
      this.db.query(`SELECT codigo, nombre_comercial FROM operador ORDER BY nombre_comercial`),
      this.db.query(`SELECT codigo_iso, nombre FROM idioma ORDER BY id`),
    ]);
    return { ciudades, categorias, operadores, idiomas };
  }

  async list(filters: { search: string | null; activa: boolean | null; limit: number; offset: number }): Promise<{ total: number; items: AdminAttractionRow[] }> {
    const where = `($1::varchar IS NULL OR f_unaccent(a.nombre) ILIKE '%' || f_unaccent($1) || '%' OR a.codigo_publico = $1 OR a.slug = $1)
      AND ($2::boolean IS NULL OR a.activa = $2)`;
    const params = [filters.search, filters.activa];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM atraccion a WHERE ${where}`, params);
    const rows = await this.db.query(
      `SELECT a.id AS uuid, a.codigo_publico, a.slug, a.nombre, ci.nombre AS ciudad, c.codigo AS categoria_codigo, c.nombre AS categoria,
              a.activa, a.popularidad, a.precio_desde_adulto, a.actualizado_en,
              (SELECT f.url FROM atraccion_foto af JOIN foto f ON f.id = af.foto_id WHERE af.atraccion_id = a.id ORDER BY af.orden LIMIT 1) AS foto
         FROM atraccion a JOIN ciudad ci ON ci.id = a.ciudad_id JOIN categoria c ON c.id = a.categoria_id
        WHERE ${where} ORDER BY a.activa DESC, a.nombre LIMIT $3 OFFSET $4`,
      [...params, filters.limit, filters.offset],
    );
    return {
      total,
      items: rows.map((r: AdminAttractionRow) => ({
        ...r, codigo_publico: r.codigo_publico.trim(), precio_desde_adulto: r.precio_desde_adulto === null ? null : Number(r.precio_desde_adulto),
        actualizado_en: new Date(r.actualizado_en).toISOString(),
      })),
    };
  }

  /** Datos editables tal como se guardaron (también de atracciones inactivas). */
  async editable(codigo: string): Promise<(AttractionInput & { uuid: string; codigo_publico: string; slug: string; activa: boolean }) | null> {
    const [a] = await this.db.query(
      `SELECT a.id, a.codigo_publico, a.slug, a.activa, a.nombre, a.descripcion_corta, a.descripcion, c.codigo AS categoria_codigo, a.ciudad_id,
              o.codigo AS operador_codigo, a.duracion_horas, a.incluye_comida, a.incluye_transporte, a.incluye_guia,
              a.pe_direccion, a.pe_latitud, a.pe_longitud, a.pe_instrucciones, a.pe_google_maps_url,
              a.accesible_silla_ruedas, a.accesible_carriola, a.admite_animales_asistencia,
              a.cancelacion_gratuita, a.cancelacion_horas_limite, a.cancelacion_descripcion, a.permite_paquete
         FROM atraccion a JOIN categoria c ON c.id = a.categoria_id JOIN operador o ON o.id = a.operador_id
        WHERE a.codigo_publico = $1 OR a.slug = $1`,
      [codigo],
    );
    if (!a) return null;
    const [idiomas, inclusiones, fotos, itinerario] = await Promise.all([
      this.db.query(`SELECT i.codigo_iso FROM atraccion_idioma ai JOIN idioma i ON i.id = ai.idioma_id WHERE ai.atraccion_id = $1 ORDER BY i.id`, [a.id]),
      this.db.query(`SELECT tipo, descripcion FROM inclusion WHERE atraccion_id = $1 ORDER BY tipo, orden`, [a.id]),
      this.db.query(`SELECT f.url FROM atraccion_foto af JOIN foto f ON f.id = af.foto_id WHERE af.atraccion_id = $1 ORDER BY af.orden`, [a.id]),
      this.db.query(
        `SELECT hora::text AS hora, titulo, descripcion, duracion_minutos, nombre_ubicacion FROM itinerario_parada WHERE atraccion_id = $1 ORDER BY numero_parada`,
        [a.id],
      ),
    ]);
    return {
      uuid: a.id, codigo_publico: a.codigo_publico.trim(), slug: a.slug, activa: a.activa,
      nombre: a.nombre, descripcion_corta: a.descripcion_corta, descripcion: a.descripcion, categoria_codigo: a.categoria_codigo, ciudad_id: a.ciudad_id,
      operador_codigo: a.operador_codigo, duracion_horas: Number(a.duracion_horas),
      incluye_comida: a.incluye_comida, incluye_transporte: a.incluye_transporte, incluye_guia: a.incluye_guia,
      punto_encuentro: { direccion: a.pe_direccion, latitud: Number(a.pe_latitud), longitud: Number(a.pe_longitud), instrucciones: a.pe_instrucciones, google_maps_url: a.pe_google_maps_url },
      accesible_silla_ruedas: a.accesible_silla_ruedas, accesible_carriola: a.accesible_carriola, admite_animales_asistencia: a.admite_animales_asistencia,
      cancelacion: { gratuita: a.cancelacion_gratuita, horas_limite: a.cancelacion_horas_limite, descripcion: a.cancelacion_descripcion },
      permite_paquete: a.permite_paquete,
      idiomas: idiomas.map((i: { codigo_iso: string }) => i.codigo_iso),
      inclusiones: inclusiones.filter((i: { tipo: string }) => i.tipo === 'INCLUYE').map((i: { descripcion: string }) => i.descripcion),
      exclusiones: inclusiones.filter((i: { tipo: string }) => i.tipo === 'EXCLUYE').map((i: { descripcion: string }) => i.descripcion),
      fotos: fotos.map((f: { url: string }) => f.url),
      itinerario,
    };
  }

  /** Referencias que debe cumplir la atracción: devuelve los nombres de los campos que no existen. */
  async missingReferences(input: AttractionInput): Promise<string[]> {
    const [row] = await this.db.query(
      `SELECT EXISTS (SELECT 1 FROM categoria WHERE codigo = $1 AND activa) AS categoria,
              EXISTS (SELECT 1 FROM ciudad WHERE id = $2) AS ciudad,
              EXISTS (SELECT 1 FROM operador WHERE codigo = $3) AS operador,
              (SELECT count(*)::int FROM idioma WHERE codigo_iso = ANY($4::char(2)[])) AS idiomas`,
      [input.categoria_codigo, input.ciudad_id, input.operador_codigo, input.idiomas],
    );
    return [
      ...(row.categoria ? [] : ['categoria_codigo']),
      ...(row.ciudad ? [] : ['ciudad_id']),
      ...(row.operador ? [] : ['operador_codigo']),
      ...(row.idiomas === new Set(input.idiomas).size ? [] : ['idiomas']),
    ];
  }

  async create(input: AttractionInput): Promise<string> {
    return this.db.transaction(async (m) => {
      const slug = await this.uniqueSlug(m, slugify(input.nombre));
      let codigo = '';
      let row: { id: string } | undefined;
      for (let attempt = 0; !row && attempt < 5; attempt++) {
        codigo = newPublicCode();
        [row] = await m.query(
          `INSERT INTO atraccion (codigo_publico, slug, nombre, descripcion_corta, descripcion, categoria_id, operador_id, ciudad_id, duracion_horas,
                                  incluye_comida, incluye_transporte, incluye_guia, pe_direccion, pe_latitud, pe_longitud, pe_instrucciones, pe_google_maps_url,
                                  accesible_silla_ruedas, accesible_carriola, admite_animales_asistencia,
                                  cancelacion_gratuita, cancelacion_horas_limite, cancelacion_descripcion, permite_paquete)
           VALUES ($1, $2, $3, $4, $5, (SELECT id FROM categoria WHERE codigo = $6), (SELECT id FROM operador WHERE codigo = $7), $8, $9,
                   $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
           ON CONFLICT (codigo_publico) DO NOTHING RETURNING id`,
          [codigo, slug, ...this.columns(input)],
        );
      }
      if (!row) throw new Error('No se pudo generar un código público único.');
      await this.replaceChildren(m, row.id, input);
      await recordEvent(m, { tipoEvento: 'AtraccionActualizada', agregadoId: codigo, payload: { atraccion_codigo: codigo, accion: 'CREADA' } });
      return codigo;
    });
  }

  /** Reemplaza los datos editables; el código público y el slug no cambian (los enlaces y Booking dependen de ellos). */
  async update(codigo: string, input: AttractionInput): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const [row] = returnedRows<{ id: string }>(await m.query(
        `UPDATE atraccion SET nombre = $2, descripcion_corta = $3, descripcion = $4, categoria_id = (SELECT id FROM categoria WHERE codigo = $5),
                operador_id = (SELECT id FROM operador WHERE codigo = $6), ciudad_id = $7, duracion_horas = $8,
                incluye_comida = $9, incluye_transporte = $10, incluye_guia = $11, pe_direccion = $12, pe_latitud = $13, pe_longitud = $14,
                pe_instrucciones = $15, pe_google_maps_url = $16, accesible_silla_ruedas = $17, accesible_carriola = $18, admite_animales_asistencia = $19,
                cancelacion_gratuita = $20, cancelacion_horas_limite = $21, cancelacion_descripcion = $22, permite_paquete = $23,
                actualizado_en = now(), version = version + 1
          WHERE codigo_publico = $1 RETURNING id`,
        [codigo, ...this.columns(input)],
      ));
      if (!row) return false;
      await this.replaceChildren(m, row.id, input);
      await recordEvent(m, { tipoEvento: 'AtraccionActualizada', agregadoId: codigo, payload: { atraccion_codigo: codigo, accion: 'ACTUALIZADA' } });
      return true;
    });
  }

  /** Activa o desactiva (las inactivas desaparecen del catálogo; sus reservas siguen vigentes). */
  async setActive(codigo: string, activa: boolean): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const rows = returnedRows(await m.query(
        `UPDATE atraccion SET activa = $2, actualizado_en = now(), version = version + 1 WHERE codigo_publico = $1 RETURNING id`,
        [codigo, activa],
      ));
      if (rows.length === 0) return false;
      await recordEvent(m, { tipoEvento: 'AtraccionActualizada', agregadoId: codigo, payload: { atraccion_codigo: codigo, accion: activa ? 'ACTIVADA' : 'DESACTIVADA' } });
      return true;
    });
  }

  /** Réplica del precio de adulto vigente (filtros y orden por precio), a partir de `TarifaActualizada` de Inventory. */
  async setPriceFrom(codigo: string, precio: number | null): Promise<void> {
    await this.db.query(`UPDATE atraccion SET precio_desde_adulto = $2 WHERE codigo_publico = $1`, [codigo, precio]);
  }

  private columns(input: AttractionInput): unknown[] {
    const pe = input.punto_encuentro;
    return [
      input.nombre, input.descripcion_corta, input.descripcion, input.categoria_codigo, input.operador_codigo, input.ciudad_id, input.duracion_horas,
      input.incluye_comida, input.incluye_transporte, input.incluye_guia, pe.direccion, pe.latitud, pe.longitud, pe.instrucciones, pe.google_maps_url,
      input.accesible_silla_ruedas, input.accesible_carriola, input.admite_animales_asistencia,
      input.cancelacion.gratuita, input.cancelacion.horas_limite, input.cancelacion.descripcion, input.permite_paquete,
    ];
  }

  private async replaceChildren(m: EntityManager, id: string, input: AttractionInput): Promise<void> {
    for (const table of ['atraccion_idioma', 'inclusion', 'atraccion_foto', 'itinerario_parada']) {
      await m.query(`DELETE FROM ${table} WHERE atraccion_id = $1`, [id]);
    }
    await m.query(
      `INSERT INTO atraccion_idioma (atraccion_id, idioma_id) SELECT $1, id FROM idioma WHERE codigo_iso = ANY($2::char(2)[])`,
      [id, input.idiomas],
    );
    for (const [tipo, list] of [['INCLUYE', input.inclusiones], ['EXCLUYE', input.exclusiones]] as const) {
      for (const [i, texto] of list.entries()) await m.query(`INSERT INTO inclusion (atraccion_id, tipo, descripcion, orden) VALUES ($1, $2, $3, $4)`, [id, tipo, texto, i + 1]);
    }
    for (const [i, url] of input.fotos.entries()) {
      const [foto] = await m.query(`INSERT INTO foto (url) VALUES ($1) ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url RETURNING id`, [url]);
      await m.query(`INSERT INTO atraccion_foto (atraccion_id, foto_id, orden) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, foto.id, i + 1]);
    }
    for (const [i, p] of input.itinerario.entries()) {
      await m.query(
        `INSERT INTO itinerario_parada (atraccion_id, numero_parada, hora, titulo, descripcion, duracion_minutos, nombre_ubicacion) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, i + 1, p.hora, p.titulo, p.descripcion, p.duracion_minutos, p.nombre_ubicacion],
      );
    }
  }

  private async uniqueSlug(m: EntityManager, base: string): Promise<string> {
    const root = RESERVED_SLUGS.includes(base) ? `${base}-atraccion` : base;
    for (let n = 1; ; n++) {
      const slug = n === 1 ? root : `${root}-${n}`;
      const [taken] = await m.query(`SELECT 1 FROM atraccion WHERE slug = $1`, [slug]);
      if (!taken) return slug;
    }
  }
}
