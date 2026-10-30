import { outboxDdl } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Rutas de `/atracciones/*` que un slug no puede ocupar porque colisionaría con `/atracciones/{id}`. */
const SLUGS_RESERVADOS = `('search', 'categorias', 'reservas', 'promociones', 'eventos', 'health')`;

/** Esquema de catalog_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 3). */
const UP = [
  `CREATE EXTENSION IF NOT EXISTS unaccent`,
  // `unaccent` es STABLE; esta versión con diccionario explícito puede declararse IMMUTABLE y usarse en índices.
  `CREATE FUNCTION f_unaccent(texto text) RETURNS text
     LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
     AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, texto) $$`,

  `CREATE TABLE region (
    id smallserial PRIMARY KEY,
    nombre varchar(60) NOT NULL CONSTRAINT uq_region_nombre UNIQUE
  )`,
  `CREATE TABLE provincia (
    id smallserial PRIMARY KEY,
    region_id smallint NOT NULL CONSTRAINT fk_provincia_region REFERENCES region (id),
    nombre varchar(80) NOT NULL,
    CONSTRAINT uq_provincia_nombre UNIQUE (region_id, nombre)
  )`,
  `CREATE TABLE ciudad (
    id serial PRIMARY KEY,
    provincia_id smallint NOT NULL CONSTRAINT fk_ciudad_provincia REFERENCES provincia (id),
    nombre varchar(120) NOT NULL,
    CONSTRAINT uq_ciudad_nombre UNIQUE (provincia_id, nombre)
  )`,
  `CREATE INDEX ix_ciudad_nombre_busqueda ON ciudad (lower(f_unaccent(nombre)))`,

  `CREATE TABLE operador (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo varchar(60) NOT NULL CONSTRAINT uq_operador_codigo UNIQUE,
    nombre_comercial varchar(200) NOT NULL,
    ruc char(13) NOT NULL CONSTRAINT uq_operador_ruc UNIQUE CONSTRAINT ck_operador_ruc CHECK (ruc ~ '^[0-9]{13}$'),
    telefono_emergencia varchar(20) NOT NULL,
    email_soporte varchar(254) NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE categoria (
    id serial PRIMARY KEY,
    codigo varchar(40) NOT NULL CONSTRAINT uq_categoria_codigo UNIQUE,
    padre_id int CONSTRAINT fk_categoria_padre REFERENCES categoria (id),
    nombre varchar(120) NOT NULL,
    slug varchar(120) NOT NULL CONSTRAINT uq_categoria_slug UNIQUE,
    descripcion varchar(500),
    icono varchar(40),
    orden smallint NOT NULL DEFAULT 0,
    incluye_comida boolean NOT NULL,
    incluye_transporte boolean NOT NULL,
    incluye_guia boolean NOT NULL,
    activa boolean NOT NULL DEFAULT true,
    CONSTRAINT ck_categoria_padre CHECK (padre_id <> id)
  )`,
  `CREATE INDEX ix_categoria_padre_orden ON categoria (padre_id, orden)`,

  `CREATE TABLE atraccion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_publico char(12) NOT NULL CONSTRAINT uq_atraccion_codigo_publico UNIQUE
      CONSTRAINT ck_atraccion_codigo_publico CHECK (codigo_publico ~ '^[A-Za-z0-9]{12}$'),
    slug varchar(160) NOT NULL CONSTRAINT uq_atraccion_slug UNIQUE
      CONSTRAINT ck_atraccion_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND slug NOT IN ${SLUGS_RESERVADOS}),
    nombre varchar(200) NOT NULL,
    descripcion_corta varchar(300) NOT NULL,
    descripcion text NOT NULL,
    categoria_id int NOT NULL CONSTRAINT fk_atraccion_categoria REFERENCES categoria (id),
    operador_id uuid NOT NULL CONSTRAINT fk_atraccion_operador REFERENCES operador (id),
    ciudad_id int NOT NULL CONSTRAINT fk_atraccion_ciudad REFERENCES ciudad (id),
    duracion_horas numeric(4,1) NOT NULL CONSTRAINT ck_atraccion_duracion CHECK (duracion_horas > 0),
    incluye_comida boolean NOT NULL,
    incluye_transporte boolean NOT NULL,
    incluye_guia boolean NOT NULL,
    pe_direccion varchar(300) NOT NULL,
    pe_latitud numeric(9,6) NOT NULL CONSTRAINT ck_atraccion_latitud CHECK (pe_latitud BETWEEN -90 AND 90),
    pe_longitud numeric(9,6) NOT NULL CONSTRAINT ck_atraccion_longitud CHECK (pe_longitud BETWEEN -180 AND 180),
    pe_instrucciones varchar(500),
    pe_google_maps_url varchar(500),
    accesible_silla_ruedas boolean NOT NULL DEFAULT false,
    accesible_carriola boolean NOT NULL DEFAULT false,
    admite_animales_asistencia boolean NOT NULL DEFAULT false,
    cancelacion_gratuita boolean NOT NULL DEFAULT false,
    cancelacion_horas_limite smallint NOT NULL DEFAULT 24 CONSTRAINT ck_atraccion_horas_limite CHECK (cancelacion_horas_limite >= 0),
    cancelacion_descripcion varchar(500),
    permite_paquete boolean NOT NULL DEFAULT false,
    precio_desde_adulto numeric(10,2) CONSTRAINT ck_atraccion_precio_desde CHECK (precio_desde_adulto >= 0),
    popularidad int NOT NULL DEFAULT 0 CONSTRAINT ck_atraccion_popularidad CHECK (popularidad >= 0),
    activa boolean NOT NULL DEFAULT true,
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    version int NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX ix_atraccion_ciudad ON atraccion (ciudad_id)`,
  `CREATE INDEX ix_atraccion_categoria ON atraccion (categoria_id)`,
  `CREATE INDEX ix_atraccion_operador ON atraccion (operador_id)`,
  `CREATE INDEX ix_atraccion_popularidad ON atraccion (activa, popularidad DESC)`,
  `CREATE INDEX ix_atraccion_precio_desde ON atraccion (precio_desde_adulto)`,
  `CREATE INDEX ix_atraccion_texto ON atraccion
     USING gin (to_tsvector('spanish', nombre || ' ' || descripcion_corta || ' ' || descripcion))`,
  // Los demás servicios referencian la atracción solo por este código: no puede cambiar.
  `CREATE FUNCTION fn_atraccion_codigo_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF NEW.codigo_publico <> OLD.codigo_publico THEN
       RAISE EXCEPTION 'codigo_publico es inmutable (atracción %)', OLD.id USING ERRCODE = '23514';
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER tg_atraccion_codigo_inmutable BEFORE UPDATE OF codigo_publico ON atraccion
     FOR EACH ROW EXECUTE FUNCTION fn_atraccion_codigo_inmutable()`,

  `CREATE TABLE idioma (
    id smallserial PRIMARY KEY,
    nombre varchar(40) NOT NULL CONSTRAINT uq_idioma_nombre UNIQUE,
    codigo_iso char(2) NOT NULL CONSTRAINT uq_idioma_codigo_iso UNIQUE CONSTRAINT ck_idioma_codigo_iso CHECK (codigo_iso ~ '^[a-z]{2}$')
  )`,
  `CREATE TABLE atraccion_idioma (
    atraccion_id uuid NOT NULL CONSTRAINT fk_atraccion_idioma_atraccion REFERENCES atraccion (id) ON DELETE CASCADE,
    idioma_id smallint NOT NULL CONSTRAINT fk_atraccion_idioma_idioma REFERENCES idioma (id),
    CONSTRAINT pk_atraccion_idioma PRIMARY KEY (atraccion_id, idioma_id)
  )`,
  `CREATE INDEX ix_atraccion_idioma_idioma ON atraccion_idioma (idioma_id)`,

  `CREATE TABLE inclusion (
    id serial PRIMARY KEY,
    atraccion_id uuid NOT NULL CONSTRAINT fk_inclusion_atraccion REFERENCES atraccion (id) ON DELETE CASCADE,
    tipo varchar(10) NOT NULL CONSTRAINT ck_inclusion_tipo CHECK (tipo IN ('INCLUYE', 'EXCLUYE')),
    descripcion varchar(300) NOT NULL,
    orden smallint NOT NULL,
    CONSTRAINT uq_inclusion_orden UNIQUE (atraccion_id, tipo, orden)
  )`,

  `CREATE TABLE foto (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url varchar(1000) NOT NULL CONSTRAINT uq_foto_url UNIQUE,
    texto_alternativo varchar(200)
  )`,
  `CREATE TABLE atraccion_foto (
    atraccion_id uuid NOT NULL CONSTRAINT fk_atraccion_foto_atraccion REFERENCES atraccion (id) ON DELETE CASCADE,
    foto_id uuid NOT NULL CONSTRAINT fk_atraccion_foto_foto REFERENCES foto (id),
    orden smallint NOT NULL,
    CONSTRAINT pk_atraccion_foto PRIMARY KEY (atraccion_id, foto_id),
    CONSTRAINT uq_atraccion_foto_orden UNIQUE (atraccion_id, orden)
  )`,

  `CREATE TABLE itinerario_parada (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    atraccion_id uuid NOT NULL CONSTRAINT fk_itinerario_parada_atraccion REFERENCES atraccion (id) ON DELETE CASCADE,
    numero_parada smallint NOT NULL CONSTRAINT ck_itinerario_parada_numero CHECK (numero_parada >= 1),
    hora time NOT NULL,
    titulo varchar(200) NOT NULL,
    descripcion varchar(1000),
    duracion_minutos smallint NOT NULL CONSTRAINT ck_itinerario_parada_duracion CHECK (duracion_minutos > 0),
    nombre_ubicacion varchar(200),
    CONSTRAINT uq_itinerario_parada_numero UNIQUE (atraccion_id, numero_parada)
  )`,

  `CREATE TABLE resena (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reserva_id uuid NOT NULL CONSTRAINT uq_resena_reserva UNIQUE,
    atraccion_id uuid NOT NULL CONSTRAINT fk_resena_atraccion REFERENCES atraccion (id),
    usuario_id uuid NOT NULL,
    puntuacion_general numeric(3,1) NOT NULL CONSTRAINT ck_resena_general CHECK (puntuacion_general BETWEEN 1 AND 10),
    limpieza numeric(3,1) NOT NULL CONSTRAINT ck_resena_limpieza CHECK (limpieza BETWEEN 1 AND 10),
    servicio numeric(3,1) NOT NULL CONSTRAINT ck_resena_servicio CHECK (servicio BETWEEN 1 AND 10),
    calidad_precio numeric(3,1) NOT NULL CONSTRAINT ck_resena_calidad_precio CHECK (calidad_precio BETWEEN 1 AND 10),
    puntualidad numeric(3,1) NOT NULL CONSTRAINT ck_resena_puntualidad CHECK (puntualidad BETWEEN 1 AND 10),
    comentario varchar(2000),
    creado_en timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX ix_resena_atraccion ON resena (atraccion_id)`,

  `CREATE TABLE acuerdo_promocion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operador_id uuid NOT NULL CONSTRAINT uq_acuerdo_promocion_operador UNIQUE CONSTRAINT fk_acuerdo_promocion_operador REFERENCES operador (id),
    permite_promociones boolean NOT NULL,
    porcentaje_descuento_maximo numeric(4,1) NOT NULL
      CONSTRAINT ck_acuerdo_promocion_porcentaje CHECK (porcentaje_descuento_maximo BETWEEN 0 AND 50),
    fecha_acuerdo date NOT NULL,
    vigencia_hasta date NOT NULL,
    condiciones_combo varchar(1000),
    contacto_nombre varchar(200),
    contacto_email varchar(254),
    contacto_telefono varchar(20),
    actualizado_por uuid,
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_acuerdo_promocion_vigencia CHECK (vigencia_hasta >= fecha_acuerdo)
  )`,
  `CREATE TABLE acuerdo_promocion_destino (
    acuerdo_id uuid NOT NULL CONSTRAINT fk_acuerdo_promocion_destino_acuerdo REFERENCES acuerdo_promocion (id) ON DELETE CASCADE,
    destino varchar(120) NOT NULL,
    CONSTRAINT pk_acuerdo_promocion_destino PRIMARY KEY (acuerdo_id, destino)
  )`,

  ...outboxDdl(),

  // rating.score, review_count y breakdown del contrato. Se refresca (CONCURRENTLY) al registrar una reseña.
  `CREATE MATERIALIZED VIEW v_atraccion_calificacion AS
     SELECT atraccion_id,
            count(*)::int AS total_resenas,
            round(avg(puntuacion_general), 1) AS puntuacion,
            round(avg(limpieza), 1) AS limpieza,
            round(avg(servicio), 1) AS servicio,
            round(avg(calidad_precio), 1) AS calidad_precio,
            round(avg(puntualidad), 1) AS puntualidad
       FROM resena
      GROUP BY atraccion_id`,
  `CREATE UNIQUE INDEX ux_v_atraccion_calificacion ON v_atraccion_calificacion (atraccion_id)`,
];

const DOWN = [
  'DROP MATERIALIZED VIEW v_atraccion_calificacion',
  'DROP TABLE outbox',
  'DROP TABLE acuerdo_promocion_destino',
  'DROP TABLE acuerdo_promocion',
  'DROP TABLE resena',
  'DROP TABLE itinerario_parada',
  'DROP TABLE atraccion_foto',
  'DROP TABLE foto',
  'DROP TABLE inclusion',
  'DROP TABLE atraccion_idioma',
  'DROP TABLE idioma',
  'DROP TABLE atraccion',
  'DROP FUNCTION fn_atraccion_codigo_inmutable()',
  'DROP TABLE categoria',
  'DROP TABLE operador',
  'DROP TABLE ciudad',
  'DROP TABLE provincia',
  'DROP TABLE region',
  'DROP FUNCTION f_unaccent(text)',
];

export class CatalogSchema1793000000000 implements MigrationInterface {
  name = 'CatalogSchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
