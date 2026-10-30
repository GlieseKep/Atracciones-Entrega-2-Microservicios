import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { AttractionInput, AttractionState, Sort } from '../contract';
import { mapUnique, type Db } from './sql-errors';

/** Fila de `atraccion` con su operador. Los NUMERIC llegan como texto. */
export interface AttractionRow {
  atr_id: string;
  atr_codigo: string;
  atr_uuid: string;
  atr_nombre: string;
  atr_slug: string;
  atr_descripcion: string;
  atr_descripcion_corta: string | null;
  atr_tipo: string;
  atr_estado: AttractionState;
  atr_latitud: string;
  atr_longitud: string;
  atr_direccion: string | null;
  atr_punto_encuentro: string | null;
  atr_instrucciones_llegada: string | null;
  atr_duracion_horas: string;
  atr_moneda: string;
  atr_precio_adulto: string | null;
  atr_precio_nino: string | null;
  atr_precio_senior: string | null;
  atr_precio_infante: string | null;
  atr_precio_estudiante: string | null;
  ciu_id: number;
  ope_id: string;
  atr_incluye_comida: boolean;
  atr_incluye_transporte: boolean;
  atr_incluye_guia: boolean;
  atr_accesible_silla_ruedas: boolean;
  atr_accesible_carriola: boolean;
  atr_admite_animales_asistencia: boolean;
  atr_cancelacion_gratuita: boolean;
  atr_horas_cancelacion: number;
  atr_politica_cancelacion: string | null;
  atr_permite_paquete: boolean;
  atr_porcentaje_descuento_paquete: string;
  atr_destacada: boolean;
  atr_calificacion_promedio: string;
  atr_calif_limpieza: string;
  atr_calif_servicio: string;
  atr_calif_calidad_precio: string;
  atr_calif_puntualidad: string;
  atr_numero_resenas: number;
  ope_codigo: string;
  ope_nombre: string;
  ope_ruc: string | null;
  ope_telefono: string | null;
  ope_correo: string | null;
}

export interface AttractionChildren {
  fotos: { atr_id: string; fot_url: string; fot_alt: string; fot_orden: number }[];
  itinerario: {
    atr_id: string;
    iti_numero_parada: number;
    iti_hora: string;
    iti_titulo: string;
    iti_descripcion: string | null;
    iti_duracion_minutos: number;
    iti_nombre_ubicacion: string | null;
  }[];
  inclusiones: { atr_id: string; inc_id: number; inc_tipo: string; inc_nombre: string }[];
  idiomas: { atr_id: string; idi_codigo: string; idi_nombre: string }[];
  categorias: { atr_id: string; cat_codigo: string }[];
}

export interface PublicFilters {
  query: string | null;
  /** Ciudades del término libre, además del texto. */
  queryCityIds: number[];
  cityIds: number[] | null;
  categoria: string | null;
  incluyeComida: boolean;
  incluyeTransporte: boolean;
  incluyeGuia: boolean;
  precioMin: number | null;
  precioMax: number | null;
  duracionMax: number | null;
  idioma: string | null;
  accesibleSillaRuedas: boolean;
  animalesAsistencia: boolean;
  cancelacionGratuita: boolean;
  codigos: string[] | null;
}

export interface AdminFilters {
  estado: AttractionState | null;
  operador: string | null;
  opeIds: number[] | null;
  q: string | null;
}

const FROM = `FROM atraccion a JOIN operador o ON o.ope_id = a.ope_id`;
const SELECT = `SELECT a.*, o.ope_codigo, o.ope_nombre, o.ope_ruc, o.ope_telefono, o.ope_correo ${FROM}`;
const ACCENTS = (expression: string) => `translate(lower(${expression}), 'áéíóúñ', 'aeioun')`;

const ORDER: Record<Sort, string> = {
  PRICE_ASC: 'a.atr_precio_adulto ASC, a.atr_id',
  PRICE_DESC: 'a.atr_precio_adulto DESC, a.atr_id',
  RATING_DESC: 'a.atr_calificacion_promedio DESC, a.atr_numero_resenas DESC, a.atr_id',
  POPULARITY: 'a.atr_numero_resenas DESC, a.atr_calificacion_promedio DESC, a.atr_id',
};

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

const UNIQUE = {
  atraccion_atr_slug_key: () => AppError.conflict('ATTRACTION_SLUG_EXISTS', 'Ya existe una atracción con ese slug.'),
};

function publicWhere(filters: PublicFilters): { where: string; params: unknown[] } {
  const conditions = [`a.atr_estado = 'PUBLICADA'`, `a.atr_eliminado_en IS NULL`];
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.query) {
    const text = `(a.atr_nombre || ' ' || a.atr_descripcion) ILIKE ${add(likePattern(filters.query))}`;
    conditions.push(filters.queryCityIds.length > 0 ? `(${text} OR a.ciu_id = ANY(${add(filters.queryCityIds)}::smallint[]))` : text);
  }
  if (filters.cityIds) conditions.push(`a.ciu_id = ANY(${add(filters.cityIds)}::smallint[])`);
  if (filters.categoria) {
    // La categoría pedida y todas sus subcategorías.
    conditions.push(`EXISTS (
      WITH RECURSIVE arbol AS (
        SELECT cat_id FROM categoria WHERE cat_codigo = ${add(filters.categoria)}
        UNION ALL
        SELECT c.cat_id FROM categoria c JOIN arbol ON c.cat_padre_id = arbol.cat_id
      )
      SELECT 1 FROM atraccion_categoria ac JOIN arbol ON arbol.cat_id = ac.cat_id WHERE ac.atr_id = a.atr_id)`);
  }
  if (filters.incluyeComida) conditions.push('a.atr_incluye_comida');
  if (filters.incluyeTransporte) conditions.push('a.atr_incluye_transporte');
  if (filters.incluyeGuia) conditions.push('a.atr_incluye_guia');
  if (filters.precioMin !== null) conditions.push(`a.atr_precio_adulto >= ${add(filters.precioMin)}`);
  if (filters.precioMax !== null) conditions.push(`a.atr_precio_adulto <= ${add(filters.precioMax)}`);
  if (filters.duracionMax !== null) conditions.push(`a.atr_duracion_horas <= ${add(filters.duracionMax)}`);
  if (filters.idioma) {
    const language = add(filters.idioma);
    conditions.push(`EXISTS (SELECT 1 FROM atraccion_idioma ai JOIN idioma i ON i.idi_id = ai.idi_id
      WHERE ai.atr_id = a.atr_id AND (${ACCENTS('i.idi_nombre')} = ${ACCENTS(`${language}::text`)} OR i.idi_codigo = lower(${language}::text)))`);
  }
  if (filters.accesibleSillaRuedas) conditions.push('a.atr_accesible_silla_ruedas');
  if (filters.animalesAsistencia) conditions.push('a.atr_admite_animales_asistencia');
  if (filters.cancelacionGratuita) conditions.push('a.atr_cancelacion_gratuita');
  if (filters.codigos) conditions.push(`a.atr_codigo = ANY(${add(filters.codigos)}::char(12)[])`);
  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export class AttractionRepository {
  constructor(private readonly db: DataSource) {}

  // Consulta pública -----------------------------------------------------------

  async search(filters: PublicFilters, sort: Sort, page: number, limit: number): Promise<{ total: number; rows: AttractionRow[] }> {
    const { where, params } = publicWhere(filters);
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total ${FROM} ${where}`, params);
    const rows = await this.db.query(
      `${SELECT} ${where} ORDER BY ${ORDER[sort]} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    return { total, rows };
  }

  /** Códigos que cumplen los filtros, para el filtro de fechas de Inventory. */
  async matchingCodes(filters: PublicFilters): Promise<string[]> {
    const { where, params } = publicWhere(filters);
    const rows = await this.db.query(`SELECT a.atr_codigo ${FROM} ${where}`, params);
    return rows.map((row: { atr_codigo: string }) => row.atr_codigo);
  }

  /** Por código, slug o UUID, sin las eliminadas. */
  async findByPublicId(id: string, db: Db = this.db): Promise<AttractionRow | null> {
    const [row] = await db.query(`${SELECT} WHERE (a.atr_codigo = $1::bpchar OR a.atr_slug = $1::text OR a.atr_uuid::text = lower($1::text)) AND a.atr_eliminado_en IS NULL`, [id]);
    return row ?? null;
  }

  async children(ids: string[], db: Db = this.db): Promise<AttractionChildren> {
    const param = [ids];
    return {
      fotos: await db.query(`SELECT atr_id, fot_url, fot_alt, fot_orden FROM atraccion_foto WHERE atr_id = ANY($1::bigint[]) ORDER BY fot_orden, fot_id`, param),
      itinerario: await db.query(
        `SELECT atr_id, iti_numero_parada, iti_hora::text AS iti_hora, iti_titulo, iti_descripcion, iti_duracion_minutos, iti_nombre_ubicacion
         FROM atraccion_itinerario WHERE atr_id = ANY($1::bigint[]) ORDER BY iti_numero_parada`,
        param,
      ),
      inclusiones: await db.query(
        `SELECT ai.atr_id, i.inc_id, i.inc_tipo, i.inc_nombre FROM atraccion_inclusion ai JOIN inclusion i ON i.inc_id = ai.inc_id
         WHERE ai.atr_id = ANY($1::bigint[]) ORDER BY i.inc_orden, i.inc_nombre`,
        param,
      ),
      idiomas: await db.query(
        `SELECT ai.atr_id, i.idi_codigo, i.idi_nombre FROM atraccion_idioma ai JOIN idioma i ON i.idi_id = ai.idi_id
         WHERE ai.atr_id = ANY($1::bigint[]) ORDER BY i.idi_nombre`,
        param,
      ),
      categorias: await db.query(
        `SELECT ac.atr_id, c.cat_codigo FROM atraccion_categoria ac JOIN categoria c ON c.cat_id = ac.cat_id
         WHERE ac.atr_id = ANY($1::bigint[]) ORDER BY c.cat_orden`,
        param,
      ),
    };
  }

  // Administración -------------------------------------------------------------

  async adminList(filters: AdminFilters, page: number, limit: number): Promise<{ total: number; rows: AttractionRow[] }> {
    const conditions = ['a.atr_eliminado_en IS NULL'];
    const params: unknown[] = [];
    const add = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (filters.estado) conditions.push(`a.atr_estado = ${add(filters.estado)}`);
    if (filters.operador) conditions.push(`o.ope_codigo = ${add(filters.operador)}`);
    if (filters.opeIds) conditions.push(`a.ope_id = ANY(${add(filters.opeIds)}::bigint[])`);
    if (filters.q) conditions.push(`a.atr_nombre ILIKE ${add(likePattern(filters.q))}`);
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total ${FROM} ${where}`, params);
    const rows = await this.db.query(
      `${SELECT} ${where} ORDER BY a.atr_creado_en DESC, a.atr_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    return { total, rows };
  }

  async slugExists(slug: string, db: Db): Promise<boolean> {
    const [row] = await db.query(`SELECT 1 FROM atraccion WHERE atr_slug = $1`, [slug]);
    return Boolean(row);
  }

  async missingCategories(codigos: string[]): Promise<string[]> {
    const rows = await this.db.query(`SELECT cat_codigo FROM categoria WHERE cat_codigo = ANY($1::varchar[]) AND cat_activa`, [codigos]);
    const found = new Set(rows.map((row: { cat_codigo: string }) => row.cat_codigo));
    return codigos.filter((codigo) => !found.has(codigo));
  }

  async missingLanguages(codigos: string[]): Promise<string[]> {
    const rows = await this.db.query(`SELECT idi_codigo FROM idioma WHERE idi_codigo = ANY($1::char(2)[])`, [codigos]);
    const found = new Set(rows.map((row: { idi_codigo: string }) => row.idi_codigo));
    return codigos.filter((codigo) => !found.has(codigo));
  }

  async missingInclusions(ids: number[]): Promise<number[]> {
    const rows = await this.db.query(`SELECT inc_id FROM inclusion WHERE inc_id = ANY($1::int[])`, [ids]);
    const found = new Set(rows.map((row: { inc_id: number }) => row.inc_id));
    return ids.filter((id) => !found.has(id));
  }

  async insert(codigo: string, slug: string, input: AttractionInput, opeId: number, m: EntityManager): Promise<string> {
    const [row] = await mapUnique(
      () =>
        m.query(
          `INSERT INTO atraccion (atr_codigo, atr_slug, atr_nombre, atr_descripcion, atr_descripcion_corta, atr_tipo, atr_latitud, atr_longitud,
             atr_direccion, atr_punto_encuentro, atr_instrucciones_llegada, atr_duracion_horas, ciu_id, ope_id, atr_incluye_comida,
             atr_incluye_transporte, atr_incluye_guia, atr_accesible_silla_ruedas, atr_accesible_carriola, atr_admite_animales_asistencia,
             atr_cancelacion_gratuita, atr_horas_cancelacion, atr_politica_cancelacion, atr_permite_paquete,
             atr_porcentaje_descuento_paquete, atr_destacada)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
           RETURNING atr_id`,
          [codigo, slug, ...this.values(input, opeId)],
        ),
      UNIQUE,
    );
    await this.replaceChildren(row.atr_id, input, m);
    return row.atr_id;
  }

  async update(atrId: string, slug: string, input: AttractionInput, opeId: number, m: EntityManager): Promise<void> {
    await mapUnique(
      () =>
        m.query(
          `UPDATE atraccion SET atr_slug = $2, atr_nombre = $3, atr_descripcion = $4, atr_descripcion_corta = $5, atr_tipo = $6,
             atr_latitud = $7, atr_longitud = $8, atr_direccion = $9, atr_punto_encuentro = $10, atr_instrucciones_llegada = $11,
             atr_duracion_horas = $12, ciu_id = $13, ope_id = $14, atr_incluye_comida = $15, atr_incluye_transporte = $16,
             atr_incluye_guia = $17, atr_accesible_silla_ruedas = $18, atr_accesible_carriola = $19,
             atr_admite_animales_asistencia = $20, atr_cancelacion_gratuita = $21, atr_horas_cancelacion = $22,
             atr_politica_cancelacion = $23, atr_permite_paquete = $24, atr_porcentaje_descuento_paquete = $25, atr_destacada = $26
           WHERE atr_id = $1`,
          [atrId, slug, ...this.values(input, opeId)],
        ),
      UNIQUE,
    );
    await this.replaceChildren(atrId, input, m);
  }

  private values(input: AttractionInput, opeId: number): unknown[] {
    return [
      input.nombre, input.descripcion, input.descripcionCorta, input.tipo, input.latitud, input.longitud, input.direccion,
      input.puntoEncuentro, input.instruccionesLlegada, input.duracionHoras, input.ciuId, opeId, input.incluyeComida,
      input.incluyeTransporte, input.incluyeGuia, input.accesibleSillaRuedas, input.accesibleCarriola,
      input.admiteAnimalesAsistencia, input.cancelacionGratuita, input.horasCancelacion, input.politicaCancelacion,
      input.permitePaquete, input.porcentajeDescuentoPaquete, input.destacada,
    ];
  }

  private async replaceChildren(atrId: string, input: AttractionInput, m: EntityManager): Promise<void> {
    for (const table of ['atraccion_categoria', 'atraccion_idioma', 'atraccion_inclusion', 'atraccion_foto', 'atraccion_itinerario']) {
      await m.query(`DELETE FROM ${table} WHERE atr_id = $1`, [atrId]);
    }
    await m.query(`INSERT INTO atraccion_categoria (atr_id, cat_id) SELECT $1, cat_id FROM categoria WHERE cat_codigo = ANY($2::varchar[])`, [atrId, input.categorias]);
    await m.query(`INSERT INTO atraccion_idioma (atr_id, idi_id) SELECT $1, idi_id FROM idioma WHERE idi_codigo = ANY($2::char(2)[])`, [atrId, input.idiomas]);
    await m.query(`INSERT INTO atraccion_inclusion (atr_id, inc_id) SELECT $1, inc_id FROM inclusion WHERE inc_id = ANY($2::int[])`, [atrId, input.inclusiones]);
    for (const foto of input.fotos) {
      await m.query(`INSERT INTO atraccion_foto (atr_id, fot_url, fot_alt, fot_orden) VALUES ($1, $2, $3, $4)`, [atrId, foto.url, foto.alt, foto.orden]);
    }
    for (const stop of input.itinerario) {
      await m.query(
        `INSERT INTO atraccion_itinerario (atr_id, iti_numero_parada, iti_hora, iti_titulo, iti_descripcion, iti_duracion_minutos, iti_nombre_ubicacion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [atrId, stop.numero, stop.hora, stop.titulo, stop.descripcion, stop.duracionMinutos, stop.ubicacion],
      );
    }
  }

  async setState(atrId: string, estado: AttractionState): Promise<void> {
    await this.db.query(`UPDATE atraccion SET atr_estado = $2 WHERE atr_id = $1`, [atrId, estado]);
  }

  async softDelete(atrId: string): Promise<void> {
    await this.db.query(`UPDATE atraccion SET atr_eliminado_en = now() WHERE atr_id = $1`, [atrId]);
  }

  // Eventos --------------------------------------------------------------------

  /** `false` si la atracción no existe. */
  async applyRatings(atrId: number, values: { promedio: number; limpieza: number; servicio: number; calidadPrecio: number; puntualidad: number; numeroResenas: number }): Promise<boolean> {
    const rows = returnedRows(
      await this.db.query(
        `UPDATE atraccion SET atr_calificacion_promedio = $2, atr_calif_limpieza = $3, atr_calif_servicio = $4, atr_calif_calidad_precio = $5,
           atr_calif_puntualidad = $6, atr_numero_resenas = $7
         WHERE atr_id = $1 RETURNING atr_id`,
        [atrId, values.promedio, values.limpieza, values.servicio, values.calidadPrecio, values.puntualidad, values.numeroResenas],
      ),
    );
    return rows.length > 0;
  }

  /** `false` si la atracción no existe. */
  async applyPrices(codigo: string, values: { moneda: string; adulto: number; nino: number; senior: number; infante: number; estudiante: number | null }): Promise<boolean> {
    const rows = returnedRows(
      await this.db.query(
        `UPDATE atraccion SET atr_moneda = $2, atr_precio_adulto = $3, atr_precio_nino = $4, atr_precio_senior = $5, atr_precio_infante = $6,
           atr_precio_estudiante = $7
         WHERE atr_codigo = $1 RETURNING atr_id`,
        [codigo, values.moneda, values.adulto, values.nino, values.senior, values.infante, values.estudiante],
      ),
    );
    return rows.length > 0;
  }
}
