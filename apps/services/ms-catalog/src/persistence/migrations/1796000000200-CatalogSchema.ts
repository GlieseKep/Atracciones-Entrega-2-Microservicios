import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL y datos iniciales literales de Plan/ms_catalog/ms_catalog.sql. */
const UP = String.raw`CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_ruc AS VARCHAR(13)
    CHECK (VALUE ~ '^[0-9]{13}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);
CREATE DOMAIN dom_moneda AS CHAR(3)
    CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN dom_porcentaje AS NUMERIC(5,2)
    CHECK (VALUE >= 0 AND VALUE <= 100);
-- Calificacion promedio en la escala 0-10 del contrato (score, breakdown)
CREATE DOMAIN dom_calificacion AS NUMERIC(4,2)
    CHECK (VALUE >= 0 AND VALUE <= 10);

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE operador (
    ope_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ope_codigo    VARCHAR(60)  NOT NULL UNIQUE,     -- ProveedorInfo.id del contrato
    ope_nombre    VARCHAR(150) NOT NULL,
    ope_ruc       dom_ruc      UNIQUE,
    ope_correo    dom_correo,
    ope_telefono  dom_telefono,
    ope_direccion VARCHAR(255),
    prov_id       SMALLINT     NOT NULL,            -- ID logico (Location)
    ope_activo    BOOLEAN      NOT NULL DEFAULT TRUE,
    ope_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ope_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_operador_prov_id ON operador (prov_id);

CREATE TABLE operador_usuario (
    ope_id      BIGINT      NOT NULL,
    usu_id      BIGINT      NOT NULL,               -- ID logico (Identity)
    opeu_cargo  VARCHAR(60) NOT NULL,               -- ADMIN, VENDEDOR, GUIA
    opeu_activo BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_operador_usuario PRIMARY KEY (ope_id, usu_id),
    CONSTRAINT fk_operador_usuario_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_operador_usuario_usu_id ON operador_usuario (usu_id);

-- Guia turistico del operador. Se asigna a la reserva (guia_asignado) y
-- valida el check-in (guia_codigo). Puede no tener cuenta en el sistema.
CREATE TABLE guia (
    gui_id                BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ope_id                BIGINT       NOT NULL,
    usu_id                BIGINT,                   -- ID logico (Identity), opcional
    gui_codigo            VARCHAR(30)  NOT NULL UNIQUE,  -- ej. GUIA-CARLOS-01
    gui_nombre            VARCHAR(150) NOT NULL,         -- ej. Lic. Carlos Morales
    gui_credencial_mintur VARCHAR(30)  NOT NULL UNIQUE,  -- credencial del Ministerio de Turismo
    gui_activo            BOOLEAN      NOT NULL DEFAULT TRUE,
    gui_creado_en         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_guia_usuario UNIQUE (usu_id),
    CONSTRAINT fk_guia_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_guia_ope_id ON guia (ope_id);

CREATE TABLE categoria (
    cat_id                 INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cat_codigo             VARCHAR(40) NOT NULL UNIQUE, -- id del contrato (ej. cat-tours-201)
    cat_padre_id           INTEGER,                  -- autorreferencia
    cat_nombre             VARCHAR(80) NOT NULL,
    cat_slug               VARCHAR(80) NOT NULL UNIQUE,
    cat_descripcion        VARCHAR(255),
    cat_icono              VARCHAR(40) NOT NULL DEFAULT 'map-pin',
    cat_orden              SMALLINT    NOT NULL DEFAULT 0,
    -- Banderas obligatorias del contrato (CategoryTreeNode)
    cat_incluye_comida     BOOLEAN     NOT NULL DEFAULT FALSE,
    cat_incluye_transporte BOOLEAN     NOT NULL DEFAULT FALSE,
    cat_incluye_guia       BOOLEAN     NOT NULL DEFAULT FALSE,
    cat_activa             BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT categoria_no_es_ella_misma CHECK (cat_padre_id IS DISTINCT FROM cat_id),
    CONSTRAINT fk_categoria_padre
        FOREIGN KEY (cat_padre_id) REFERENCES categoria (cat_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_categoria_cat_padre_id ON categoria (cat_padre_id);

CREATE TABLE idioma (
    idi_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idi_codigo CHAR(2)     NOT NULL UNIQUE,          -- ISO 639-1
    idi_nombre VARCHAR(50) NOT NULL
);

-- inclusions_list / exclusions_list del contrato
CREATE TABLE inclusion (
    inc_id     INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inc_tipo   VARCHAR(20)  NOT NULL,                -- INCLUYE, NO_INCLUYE, RECOMENDACION
    inc_nombre VARCHAR(150) NOT NULL,
    inc_orden  SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT uq_inclusion_tipo_nombre UNIQUE (inc_tipo, inc_nombre),
    CONSTRAINT inclusion_tipo_valido
        CHECK (inc_tipo IN ('INCLUYE', 'NO_INCLUYE', 'RECOMENDACION'))
);
CREATE INDEX ix_inclusion_inc_tipo ON inclusion (inc_tipo);

CREATE TABLE atraccion (
    atr_id              BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo          CHAR(12)      NOT NULL,      -- id del contrato (ej. PRhu4UBTWPBC)
    atr_uuid            UUID          NOT NULL DEFAULT gen_random_uuid(),  -- uuid del contrato
    atr_nombre          VARCHAR(200)  NOT NULL,
    atr_slug            VARCHAR(220)  NOT NULL UNIQUE,
    atr_descripcion     TEXT          NOT NULL,
    atr_descripcion_corta VARCHAR(280),
    atr_tipo            VARCHAR(30)   NOT NULL,      -- GUIDED_TOUR, ADMISSION, DAY_TRIP, TRANSPORT, PACKAGE
    atr_estado          VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR',  -- BORRADOR, PUBLICADA, INACTIVA
    -- Punto de encuentro (meeting_point_geo)
    atr_latitud         NUMERIC(10,6) NOT NULL,
    atr_longitud        NUMERIC(10,6) NOT NULL,
    atr_direccion       VARCHAR(255),
    atr_punto_encuentro VARCHAR(255),
    atr_instrucciones_llegada VARCHAR(500),          -- arrival_instructions
    atr_duracion_horas  NUMERIC(5,2)  NOT NULL,
    atr_moneda          dom_moneda    NOT NULL DEFAULT 'USD',
    -- TarifaBaseDesglosada: replica de Pricing (evento TARIFA_ACTUALIZADA).
    -- atr_precio_adulto es el precio "desde" de los listados.
    atr_precio_adulto     dom_importe,
    atr_precio_nino       dom_importe,
    atr_precio_senior     dom_importe,
    atr_precio_infante    dom_importe,
    atr_precio_estudiante dom_importe,
    ciu_id              SMALLINT      NOT NULL,      -- ID logico (Location)
    ope_id              BIGINT        NOT NULL,
    -- Banderas de inclusion (inclusions)
    atr_incluye_comida     BOOLEAN    NOT NULL DEFAULT FALSE,
    atr_incluye_transporte BOOLEAN    NOT NULL DEFAULT FALSE,
    atr_incluye_guia       BOOLEAN    NOT NULL DEFAULT FALSE,
    -- Accesibilidad (accessibility)
    atr_accesible_silla_ruedas     BOOLEAN NOT NULL DEFAULT FALSE,
    atr_accesible_carriola         BOOLEAN NOT NULL DEFAULT FALSE,
    atr_admite_animales_asistencia BOOLEAN NOT NULL DEFAULT FALSE,
    -- Politica de cancelacion (cancellation_policy)
    atr_cancelacion_gratuita BOOLEAN  NOT NULL DEFAULT FALSE,
    atr_horas_cancelacion    SMALLINT NOT NULL DEFAULT 24,
    atr_politica_cancelacion VARCHAR(500),
    -- Paquetes y combos con Booking
    atr_permite_paquete             BOOLEAN        NOT NULL DEFAULT FALSE,
    atr_porcentaje_descuento_paquete dom_porcentaje NOT NULL DEFAULT 0,
    atr_destacada       BOOLEAN       NOT NULL DEFAULT FALSE,
    -- Calificaciones (evento RESENA_PUBLICADA, escala 0-10)
    atr_calificacion_promedio  dom_calificacion NOT NULL DEFAULT 0,
    atr_calif_limpieza         dom_calificacion NOT NULL DEFAULT 0,
    atr_calif_servicio         dom_calificacion NOT NULL DEFAULT 0,
    atr_calif_calidad_precio   dom_calificacion NOT NULL DEFAULT 0,
    atr_calif_puntualidad      dom_calificacion NOT NULL DEFAULT 0,
    atr_numero_resenas  INTEGER       NOT NULL DEFAULT 0,
    atr_creado_en       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atr_actualizado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atr_eliminado_en    TIMESTAMPTZ,                 -- borrado logico
    CONSTRAINT uq_atraccion_uuid UNIQUE (atr_uuid),
    CONSTRAINT uq_atraccion_codigo UNIQUE (atr_codigo),
    CONSTRAINT atraccion_codigo_formato CHECK (atr_codigo ~ '^[A-Za-z0-9]{12}$'),
    CONSTRAINT atraccion_duracion_valida
        CHECK (atr_duracion_horas > 0 AND atr_duracion_horas <= 720),
    CONSTRAINT atraccion_latitud_valida  CHECK (atr_latitud BETWEEN -90 AND 90),
    CONSTRAINT atraccion_longitud_valida CHECK (atr_longitud BETWEEN -180 AND 180),
    CONSTRAINT atraccion_horas_cancelacion_valida CHECK (atr_horas_cancelacion >= 0),
    CONSTRAINT atraccion_numero_resenas_valido CHECK (atr_numero_resenas >= 0),
    -- Sin paquete no hay descuento de paquete
    CONSTRAINT atraccion_descuento_paquete_coherente
        CHECK (atr_permite_paquete OR atr_porcentaje_descuento_paquete = 0),
    CONSTRAINT atraccion_tipo_valido
        CHECK (atr_tipo IN ('GUIDED_TOUR', 'ADMISSION', 'DAY_TRIP', 'TRANSPORT', 'PACKAGE')),
    CONSTRAINT atraccion_estado_valido
        CHECK (atr_estado IN ('BORRADOR', 'PUBLICADA', 'INACTIVA')),
    CONSTRAINT fk_atraccion_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_atraccion_ciu_id ON atraccion (ciu_id);
CREATE INDEX ix_atraccion_ope_id ON atraccion (ope_id);
CREATE INDEX ix_atraccion_estado ON atraccion (atr_estado);
CREATE INDEX ix_atraccion_precio_adulto ON atraccion (atr_precio_adulto);
CREATE INDEX ix_atraccion_busqueda
    ON atraccion USING gin ((atr_nombre || ' ' || atr_descripcion) gin_trgm_ops);

CREATE TABLE atraccion_categoria (
    atr_id BIGINT  NOT NULL,
    cat_id INTEGER NOT NULL,
    CONSTRAINT pk_atraccion_categoria PRIMARY KEY (atr_id, cat_id),
    CONSTRAINT fk_atraccion_categoria_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_categoria_categoria
        FOREIGN KEY (cat_id) REFERENCES categoria (cat_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_categoria_cat_id ON atraccion_categoria (cat_id);

-- guide_languages del contrato
CREATE TABLE atraccion_idioma (
    atr_id BIGINT   NOT NULL,
    idi_id SMALLINT NOT NULL,
    CONSTRAINT pk_atraccion_idioma PRIMARY KEY (atr_id, idi_id),
    CONSTRAINT fk_atraccion_idioma_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_idioma_idioma
        FOREIGN KEY (idi_id) REFERENCES idioma (idi_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_atraccion_idioma_idi_id ON atraccion_idioma (idi_id);

CREATE TABLE atraccion_inclusion (
    atr_id BIGINT  NOT NULL,
    inc_id INTEGER NOT NULL,
    CONSTRAINT pk_atraccion_inclusion PRIMARY KEY (atr_id, inc_id),
    CONSTRAINT fk_atraccion_inclusion_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_inclusion_inclusion
        FOREIGN KEY (inc_id) REFERENCES inclusion (inc_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_inclusion_inc_id ON atraccion_inclusion (inc_id);

CREATE TABLE atraccion_foto (
    fot_id    BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id    BIGINT       NOT NULL,
    fot_url   VARCHAR(500) NOT NULL,
    fot_alt   VARCHAR(200) NOT NULL,                 -- texto alternativo (WCAG 1.1.1)
    fot_orden SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT fk_atraccion_foto_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_foto_atr_id ON atraccion_foto (atr_id);

-- Itinerario paso a paso (itinerary / ItineraryStop del contrato)
CREATE TABLE atraccion_itinerario (
    iti_id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id               BIGINT       NOT NULL,
    iti_numero_parada    SMALLINT     NOT NULL,      -- stop_number
    iti_hora             TIME         NOT NULL,      -- time (se formatea "09:00 a.m.")
    iti_titulo           VARCHAR(200) NOT NULL,      -- title
    iti_descripcion      VARCHAR(500),               -- description
    iti_duracion_minutos SMALLINT     NOT NULL,      -- duration_minutes
    iti_nombre_ubicacion VARCHAR(200),               -- location_name
    CONSTRAINT uq_atraccion_itinerario_parada UNIQUE (atr_id, iti_numero_parada),
    CONSTRAINT atraccion_itinerario_parada_valida CHECK (iti_numero_parada > 0),
    CONSTRAINT atraccion_itinerario_duracion_valida CHECK (iti_duracion_minutos > 0),
    CONSTRAINT fk_atraccion_itinerario_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TRIGGER trg_operador_actualizado BEFORE UPDATE ON operador
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('ope_actualizado_en');
CREATE TRIGGER trg_atraccion_actualizado BEFORE UPDATE ON atraccion
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('atr_actualizado_en');

-- Sin JOIN a geografia (vive en Location): se expone ciu_id para resolverlo por API.
CREATE VIEW v_atraccion_completa AS
SELECT a.atr_id, a.atr_codigo, a.atr_nombre, a.atr_slug, a.atr_estado, a.atr_tipo,
       a.ciu_id, o.ope_nombre AS operador, o.ope_ruc AS operador_ruc
FROM atraccion a
JOIN operador o ON o.ope_id = a.ope_id;

INSERT INTO idioma (idi_codigo, idi_nombre) VALUES
    ('es','Espanol'), ('en','Ingles'), ('fr','Frances'), ('de','Aleman');

INSERT INTO categoria (cat_codigo, cat_nombre, cat_slug, cat_descripcion, cat_orden,
                       cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia) VALUES
    ('cat-aventura-100',    'Aventura',   'aventura',   'Deportes extremos y naturaleza', 1, FALSE, TRUE,  TRUE),
    ('cat-cultural-100',    'Cultural',   'cultural',   'Patrimonio e historia',          2, FALSE, FALSE, TRUE),
    ('cat-naturales-100',   'Naturales',  'naturales',  'Ecosistemas y fauna',            3, FALSE, TRUE,  TRUE),
    ('cat-gastronomia-100', 'Gastronomia','gastronomia','Comida y bebida local',          4, TRUE,  FALSE, TRUE),
    ('cat-playas-100',      'Playas',     'playas',     'Costa y litoral',                5, FALSE, FALSE, FALSE),
    ('cat-montana-100',     'Montana',    'montana',    'Sierra y senderismo',            6, FALSE, TRUE,  TRUE);`;

const DOWN = [
  'DROP VIEW v_atraccion_completa',
  'DROP TABLE atraccion_itinerario',
  'DROP TABLE atraccion_foto',
  'DROP TABLE atraccion_inclusion',
  'DROP TABLE atraccion_idioma',
  'DROP TABLE atraccion_categoria',
  'DROP TABLE atraccion',
  'DROP TABLE inclusion',
  'DROP TABLE idioma',
  'DROP TABLE categoria',
  'DROP TABLE guia',
  'DROP TABLE operador_usuario',
  'DROP TABLE operador',
  'DROP FUNCTION fn_actualizar_timestamp',
  'DROP DOMAIN dom_calificacion',
  'DROP DOMAIN dom_porcentaje',
  'DROP DOMAIN dom_moneda',
  'DROP DOMAIN dom_importe',
  'DROP DOMAIN dom_telefono',
  'DROP DOMAIN dom_ruc',
  'DROP DOMAIN dom_correo',
];

export class CatalogSchema1796000000200 implements MigrationInterface {
  name = 'CatalogSchema1796000000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of DOWN) await queryRunner.query(sentence);
  }
}
