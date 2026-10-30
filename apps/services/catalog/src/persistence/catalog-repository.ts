import type { DataSource, EntityManager } from 'typeorm';

export interface CategoryRow {
  id: number;
  codigo: string;
  padre_codigo: string | null;
  nombre: string;
  slug: string;
  descripcion: string | null;
  icono: string | null;
  orden: number;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
}

export interface SearchFilters {
  query?: string | null;
  ciudad?: string | null;
  categoria?: string | null;
  incluye_comida?: boolean | null;
  incluye_transporte?: boolean | null;
  incluye_guia?: boolean | null;
  precio_min?: number | null;
  precio_max?: number | null;
  duracion_max_horas?: number | null;
  idioma_guia?: string | null;
  accesible_silla_ruedas?: boolean | null;
  animales_asistencia?: boolean | null;
  cancelacion_gratuita?: boolean | null;
  /** Restringe a estos códigos (p. ej. los que tienen disponibilidad en las fechas pedidas). */
  codigos?: string[] | null;
  sort?: 'PRICE_ASC' | 'PRICE_DESC' | 'RATING_DESC' | 'POPULARITY';
  page: number;
  limit: number;
  /** Solo devuelve los códigos de todas las coincidencias (sin paginar). */
  solo_codigos?: boolean;
}

/** Calificación de la vista materializada (0 si la atracción aún no tiene reseñas). */
export interface Rating {
  puntuacion: number;
  total_resenas: number;
  limpieza: number;
  servicio: number;
  calidad_precio: number;
  puntualidad: number;
}

export interface AttractionSummary {
  uuid: string;
  codigo_publico: string;
  slug: string;
  nombre: string;
  descripcion_corta: string;
  ciudad: string;
  duracion_horas: number;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
  punto_encuentro: string;
  cancelacion_gratuita: boolean;
  cancelacion_horas_limite: number;
  /** `permite_paquete` efectivo: el de la atracción y el acuerdo de promociones vigente para su ciudad. */
  permite_paquete: boolean;
  porcentaje_descuento_paquete: number;
  fotos: string[];
  calificacion: Rating;
}

export interface AttractionDetail extends AttractionSummary {
  descripcion: string;
  pe_latitud: number;
  pe_longitud: number;
  pe_instrucciones: string | null;
  pe_google_maps_url: string | null;
  accesible_silla_ruedas: boolean;
  accesible_carriola: boolean;
  admite_animales_asistencia: boolean;
  cancelacion_descripcion: string | null;
  idiomas: string[];
  inclusiones: string[];
  exclusiones: string[];
  itinerario: { numero_parada: number; hora: string; titulo: string; descripcion: string | null; duracion_minutos: number; nombre_ubicacion: string | null }[];
  proveedor: { codigo: string; nombre_comercial: string; ruc: string; telefono_emergencia: string; email_soporte: string };
}

export interface PromotionAgreement {
  proveedor_id: string;
  nombre_comercial: string;
  permite_promociones: boolean;
  porcentaje_descuento_maximo: number;
  destinos_habilitados: string[];
  fecha_acuerdo: string | null;
  vigencia_hasta: string;
  condiciones_combo: string | null;
  contacto: { nombre: string | null; email: string | null; telefono: string | null };
}

const num = (v: unknown) => Number(v ?? 0);

/** Acuerdo vigente por operador: si está vigente hoy, para qué destinos y con qué descuento (plan §4.1). */
const AGREEMENT = `
  LEFT JOIN acuerdo_promocion ap ON ap.operador_id = a.operador_id AND ap.permite_promociones
        AND ap.fecha_acuerdo <= $TODAY::date AND ap.vigencia_hasta >= $TODAY::date
  LEFT JOIN LATERAL (
    SELECT true AS habilitado FROM acuerdo_promocion_destino d
     WHERE d.acuerdo_id = ap.id AND lower(f_unaccent(d.destino)) IN (lower(f_unaccent(ci.nombre)), lower(f_unaccent(pr.nombre)))
     LIMIT 1) dest ON true`;

const SUMMARY_COLUMNS = `
  a.id AS uuid, a.codigo_publico, a.slug, a.nombre, a.descripcion_corta, ci.nombre AS ciudad, a.duracion_horas,
  a.incluye_comida, a.incluye_transporte, a.incluye_guia, a.pe_direccion AS punto_encuentro,
  a.cancelacion_gratuita, a.cancelacion_horas_limite,
  (a.permite_paquete AND coalesce(dest.habilitado, false)) AS permite_paquete,
  CASE WHEN a.permite_paquete AND coalesce(dest.habilitado, false) THEN ap.porcentaje_descuento_maximo ELSE 0 END AS porcentaje_descuento_paquete,
  coalesce((SELECT array_agg(f.url ORDER BY af.orden) FROM atraccion_foto af JOIN foto f ON f.id = af.foto_id WHERE af.atraccion_id = a.id), '{}') AS fotos,
  coalesce(r.puntuacion, 0) AS r_puntuacion, coalesce(r.total_resenas, 0) AS r_total, coalesce(r.limpieza, 0) AS r_limpieza,
  coalesce(r.servicio, 0) AS r_servicio, coalesce(r.calidad_precio, 0) AS r_calidad_precio, coalesce(r.puntualidad, 0) AS r_puntualidad`;

const FROM = `
  FROM atraccion a
  JOIN ciudad ci ON ci.id = a.ciudad_id
  JOIN provincia pr ON pr.id = ci.provincia_id
  LEFT JOIN v_atraccion_calificacion r ON r.atraccion_id = a.id`;

const ORDER: Record<NonNullable<SearchFilters['sort']>, string> = {
  PRICE_ASC: 'a.precio_desde_adulto ASC NULLS LAST',
  PRICE_DESC: 'a.precio_desde_adulto DESC NULLS LAST',
  RATING_DESC: 'coalesce(r.puntuacion, 0) DESC, coalesce(r.total_resenas, 0) DESC',
  POPULARITY: 'a.popularidad DESC',
};

function toSummary(row: Record<string, unknown>): AttractionSummary {
  return {
    uuid: String(row.uuid),
    codigo_publico: String(row.codigo_publico),
    slug: String(row.slug),
    nombre: String(row.nombre),
    descripcion_corta: String(row.descripcion_corta),
    ciudad: String(row.ciudad),
    duracion_horas: num(row.duracion_horas),
    incluye_comida: Boolean(row.incluye_comida),
    incluye_transporte: Boolean(row.incluye_transporte),
    incluye_guia: Boolean(row.incluye_guia),
    punto_encuentro: String(row.punto_encuentro),
    cancelacion_gratuita: Boolean(row.cancelacion_gratuita),
    cancelacion_horas_limite: num(row.cancelacion_horas_limite),
    permite_paquete: Boolean(row.permite_paquete),
    porcentaje_descuento_paquete: num(row.porcentaje_descuento_paquete),
    fotos: (row.fotos as string[]) ?? [],
    calificacion: {
      puntuacion: num(row.r_puntuacion), total_resenas: num(row.r_total), limpieza: num(row.r_limpieza),
      servicio: num(row.r_servicio), calidad_precio: num(row.r_calidad_precio), puntualidad: num(row.r_puntualidad),
    },
  };
}

/** Acceso a catalog_db con SQL explícito. */
export class CatalogRepository {
  constructor(
    private readonly db: DataSource | EntityManager,
    private readonly today: () => string,
  ) {}

  private withToday(sql: string, todayParam: number): string {
    return sql.replace(/\$TODAY/g, () => `$${todayParam}`);
  }

  async categories(): Promise<CategoryRow[]> {
    return this.db.query(
      `SELECT c.id, c.codigo, p.codigo AS padre_codigo, c.nombre, c.slug, c.descripcion, c.icono, c.orden,
              c.incluye_comida, c.incluye_transporte, c.incluye_guia
         FROM categoria c LEFT JOIN categoria p ON p.id = c.padre_id
        WHERE c.activa ORDER BY c.orden, c.nombre`,
    );
  }

  async search(filters: SearchFilters): Promise<{ total: number; items: AttractionSummary[]; codigos: string[] }> {
    const params: unknown[] = [];
    const where: string[] = ['a.activa'];
    const add = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (filters.query) {
      const p = add(filters.query);
      where.push(`(to_tsvector('spanish', a.nombre || ' ' || a.descripcion_corta || ' ' || a.descripcion) @@ plainto_tsquery('spanish', ${p})
                   OR f_unaccent(a.nombre) ILIKE '%' || f_unaccent(${p}) || '%'
                   OR f_unaccent(ci.nombre) ILIKE '%' || f_unaccent(${p}) || '%')`);
    }
    if (filters.ciudad) where.push(`lower(f_unaccent(ci.nombre)) = lower(f_unaccent(${add(filters.ciudad)}))`);
    if (filters.categoria) {
      where.push(`a.categoria_id IN (WITH RECURSIVE sub AS (SELECT id FROM categoria WHERE codigo = ${add(filters.categoria)}
                    UNION ALL SELECT c.id FROM categoria c JOIN sub ON c.padre_id = sub.id) SELECT id FROM sub)`);
    }
    for (const flag of ['incluye_comida', 'incluye_transporte', 'incluye_guia', 'cancelacion_gratuita'] as const) {
      if (filters[flag] === true) where.push(`a.${flag}`);
      if (filters[flag] === false) where.push(`NOT a.${flag}`);
    }
    if (filters.accesible_silla_ruedas === true) where.push('a.accesible_silla_ruedas');
    if (filters.animales_asistencia === true) where.push('a.admite_animales_asistencia');
    if (filters.precio_min != null) where.push(`a.precio_desde_adulto >= ${add(filters.precio_min)}`);
    if (filters.precio_max != null) where.push(`a.precio_desde_adulto <= ${add(filters.precio_max)}`);
    if (filters.duracion_max_horas != null) where.push(`a.duracion_horas <= ${add(filters.duracion_max_horas)}`);
    if (filters.idioma_guia) {
      const p = add(filters.idioma_guia);
      where.push(`EXISTS (SELECT 1 FROM atraccion_idioma ai JOIN idioma i ON i.id = ai.idioma_id
                   WHERE ai.atraccion_id = a.id AND (lower(f_unaccent(i.nombre)) = lower(f_unaccent(${p})) OR i.codigo_iso = lower(${p})))`);
    }
    if (filters.codigos) where.push(`a.codigo_publico = ANY(${add(filters.codigos)}::char(12)[])`);

    const condition = where.join(' AND ');
    if (filters.solo_codigos) {
      const rows: { codigo_publico: string }[] = await this.db.query(`SELECT a.codigo_publico ${FROM} WHERE ${condition}`, params);
      return { total: rows.length, items: [], codigos: rows.map((r) => r.codigo_publico) };
    }
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total ${FROM} WHERE ${condition}`, params);
    const limit = add(filters.limit);
    const offset = add((filters.page - 1) * filters.limit);
    add(this.today());
    const rows = await this.db.query(
      this.withToday(
        `SELECT ${SUMMARY_COLUMNS} ${FROM} ${AGREEMENT}
          WHERE ${condition}
          ORDER BY ${ORDER[filters.sort ?? 'POPULARITY']}, a.codigo_publico
          LIMIT ${limit} OFFSET ${offset}`,
        params.length,
      ),
      params,
    );
    return { total, items: rows.map(toSummary), codigos: [] };
  }

  /** Detalle por código público, slug o uuid; solo atracciones activas. */
  async detail(identifier: string): Promise<AttractionDetail | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    const [row] = await this.db.query(
      this.withToday(
        `SELECT ${SUMMARY_COLUMNS}, a.descripcion, a.pe_latitud, a.pe_longitud, a.pe_instrucciones, a.pe_google_maps_url,
                a.accesible_silla_ruedas, a.accesible_carriola, a.admite_animales_asistencia, a.cancelacion_descripcion,
                o.codigo AS o_codigo, o.nombre_comercial AS o_nombre, o.ruc AS o_ruc, o.telefono_emergencia AS o_telefono, o.email_soporte AS o_email
           ${FROM} JOIN operador o ON o.id = a.operador_id ${AGREEMENT}
          WHERE a.activa AND (a.codigo_publico = $2 OR a.slug = $2 ${isUuid ? 'OR a.id = $2::uuid' : ''})`,
        1,
      ),
      [this.today(), identifier],
    );
    if (!row) return null;
    const [idiomas, inclusiones, itinerario] = await Promise.all([
      this.db.query(`SELECT i.nombre FROM atraccion_idioma ai JOIN idioma i ON i.id = ai.idioma_id WHERE ai.atraccion_id = $1 ORDER BY i.id`, [row.uuid]),
      this.db.query(`SELECT tipo, descripcion FROM inclusion WHERE atraccion_id = $1 ORDER BY tipo, orden`, [row.uuid]),
      this.db.query(
        `SELECT numero_parada, hora::text AS hora, titulo, descripcion, duracion_minutos, nombre_ubicacion
           FROM itinerario_parada WHERE atraccion_id = $1 ORDER BY numero_parada`,
        [row.uuid],
      ),
    ]);
    return {
      ...toSummary(row),
      descripcion: row.descripcion,
      pe_latitud: num(row.pe_latitud),
      pe_longitud: num(row.pe_longitud),
      pe_instrucciones: row.pe_instrucciones,
      pe_google_maps_url: row.pe_google_maps_url,
      accesible_silla_ruedas: row.accesible_silla_ruedas,
      accesible_carriola: row.accesible_carriola,
      admite_animales_asistencia: row.admite_animales_asistencia,
      cancelacion_descripcion: row.cancelacion_descripcion,
      idiomas: idiomas.map((i: { nombre: string }) => i.nombre),
      inclusiones: inclusiones.filter((i: { tipo: string }) => i.tipo === 'INCLUYE').map((i: { descripcion: string }) => i.descripcion),
      exclusiones: inclusiones.filter((i: { tipo: string }) => i.tipo === 'EXCLUYE').map((i: { descripcion: string }) => i.descripcion),
      itinerario,
      proveedor: { codigo: row.o_codigo, nombre_comercial: row.o_nombre, ruc: row.o_ruc, telefono_emergencia: row.o_telefono, email_soporte: row.o_email },
    };
  }

  async agreement(operadorCodigo: string): Promise<PromotionAgreement | null> {
    const [row] = await this.db.query(
      `SELECT o.codigo, o.nombre_comercial, ap.permite_promociones, ap.porcentaje_descuento_maximo, ap.fecha_acuerdo::text AS fecha_acuerdo,
              ap.vigencia_hasta::text AS vigencia_hasta, ap.condiciones_combo, ap.contacto_nombre, ap.contacto_email, ap.contacto_telefono,
              coalesce((SELECT array_agg(d.destino ORDER BY d.destino) FROM acuerdo_promocion_destino d WHERE d.acuerdo_id = ap.id), '{}') AS destinos
         FROM operador o LEFT JOIN acuerdo_promocion ap ON ap.operador_id = o.id
        WHERE o.codigo = $1`,
      [operadorCodigo],
    );
    if (!row) return null;
    return {
      proveedor_id: row.codigo,
      nombre_comercial: row.nombre_comercial,
      permite_promociones: row.permite_promociones ?? false,
      porcentaje_descuento_maximo: num(row.porcentaje_descuento_maximo),
      destinos_habilitados: row.destinos,
      fecha_acuerdo: row.fecha_acuerdo,
      vigencia_hasta: row.vigencia_hasta ?? this.today(),
      condiciones_combo: row.condiciones_combo,
      contacto: { nombre: row.contacto_nombre, email: row.contacto_email, telefono: row.contacto_telefono },
    };
  }

  /** Reemplaza el acuerdo del operador (una fila por operador) y sus destinos. */
  async saveAgreement(
    operadorCodigo: string,
    data: { permite: boolean; porcentaje: number; destinos: string[] | null; vigenciaHasta: string; condiciones: string | null; contacto: PromotionAgreement['contacto'] | null; actor: string | null },
  ): Promise<boolean> {
    const run = async (m: DataSource | EntityManager) => {
      const [operador] = await m.query(`SELECT id FROM operador WHERE codigo = $1`, [operadorCodigo]);
      if (!operador) return false;
      const [acuerdo] = await m.query(
        `INSERT INTO acuerdo_promocion (operador_id, permite_promociones, porcentaje_descuento_maximo, fecha_acuerdo, vigencia_hasta, condiciones_combo,
                                        contacto_nombre, contacto_email, contacto_telefono, actualizado_por, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT ON CONSTRAINT uq_acuerdo_promocion_operador DO UPDATE SET
           permite_promociones = EXCLUDED.permite_promociones, porcentaje_descuento_maximo = EXCLUDED.porcentaje_descuento_maximo,
           fecha_acuerdo = EXCLUDED.fecha_acuerdo, vigencia_hasta = EXCLUDED.vigencia_hasta,
           condiciones_combo = coalesce(EXCLUDED.condiciones_combo, acuerdo_promocion.condiciones_combo),
           contacto_nombre = coalesce(EXCLUDED.contacto_nombre, acuerdo_promocion.contacto_nombre),
           contacto_email = coalesce(EXCLUDED.contacto_email, acuerdo_promocion.contacto_email),
           contacto_telefono = coalesce(EXCLUDED.contacto_telefono, acuerdo_promocion.contacto_telefono),
           actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()
         RETURNING id`,
        [operador.id, data.permite, data.porcentaje, this.today(), data.vigenciaHasta, data.condiciones,
          data.contacto?.nombre ?? null, data.contacto?.email ?? null, data.contacto?.telefono ?? null, data.actor],
      );
      if (data.destinos) {
        await m.query(`DELETE FROM acuerdo_promocion_destino WHERE acuerdo_id = $1`, [acuerdo.id]);
        for (const destino of new Set(data.destinos.map((d) => d.trim()).filter(Boolean))) {
          await m.query(`INSERT INTO acuerdo_promocion_destino (acuerdo_id, destino) VALUES ($1, $2)`, [acuerdo.id, destino]);
        }
      }
      return true;
    };
    return 'transaction' in this.db ? this.db.transaction(run) : run(this.db);
  }
}
