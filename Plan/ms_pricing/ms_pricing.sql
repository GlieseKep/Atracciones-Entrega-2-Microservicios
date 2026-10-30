-- ============================================================================
--  DESCUBRE EC  ·  ms_pricing  ·  Pricing Service (gRPC)
--  Base de datos propia del microservicio 6.
--  Plan: Plan/ms_pricing/PLAN_IMPLEMENTACION.md
--  Contrato: Plan/ms_pricing/pricing.proto
--  Origen: script propio, indicado en la seccion 6 de
--          Plan/02_microservicios_v2_bases_de_datos.sql
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: tarifa, outbox (TARIFA_ACTUALIZADA)
--  Referencias externas (ID logico, sin FK):
--    tarifa.atr_codigo -> atraccion.codigo_publico (Catalog)
--  tar_tipo usa los tipos de boleto del contrato v3 (TarifaBaseDesglosada):
--  ADULT, CHILD, SENIOR, INFANT (precio 0 pero ocupa cupo), STUDENT.
--
--  Restriccion de exclusion: dos versiones de la misma tarifa (atraccion + tipo)
--  no pueden tener vigencias que se crucen (TARIFF_OVERLAP de SetPriceTable).
--  Necesita la extension btree_gist (incluida en PostgreSQL).
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_pricing.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_pricing ENCODING 'UTF8';
\connect ms_pricing

CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE DOMAIN dom_moneda AS CHAR(3)
    CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

-- Tarifas versionadas. El precio no se recalcula al vuelo: Order guarda el
-- precio aplicado (QuoteTickets) en orden_detalle.
CREATE TABLE tarifa (
    tar_id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- tariff_id
    atr_codigo        CHAR(12)    NOT NULL,         -- attraction_id: codigo publico (Catalog)
    tar_tipo          VARCHAR(20) NOT NULL,         -- ticket_type
    tar_precio        dom_importe NOT NULL,         -- price
    tar_moneda        dom_moneda  NOT NULL DEFAULT 'USD',
    tar_vigente_desde DATE        NOT NULL DEFAULT CURRENT_DATE,  -- valid_from
    tar_vigente_hasta DATE,                         -- valid_to (NULL = vigente sin fin)
    CONSTRAINT uq_tarifa_atraccion_tipo_desde UNIQUE (atr_codigo, tar_tipo, tar_vigente_desde),
    CONSTRAINT tarifa_atr_codigo_formato CHECK (atr_codigo ~ '^[A-Za-z0-9]{12}$'),
    CONSTRAINT tarifa_tipo_valido
        CHECK (tar_tipo IN ('ADULT', 'CHILD', 'SENIOR', 'INFANT', 'STUDENT')),
    CONSTRAINT tarifa_vigencia_valida
        CHECK (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= tar_vigente_desde),
    -- Sin solapes entre versiones de la misma atraccion y tipo (TARIFF_OVERLAP).
    CONSTRAINT ex_tarifa_sin_solape EXCLUDE USING gist (
        atr_codigo WITH =,
        tar_tipo WITH =,
        daterange(tar_vigente_desde, tar_vigente_hasta, '[]') WITH &&
    )
);
CREATE INDEX ix_tarifa_atr_codigo ON tarifa (atr_codigo);

-- Transactional Outbox: TARIFA_ACTUALIZADA se escribe en la misma transaccion
-- que el cambio de tarifa y el relay del servicio lo publica en el bus.
CREATE TABLE outbox (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id       UUID         NOT NULL CONSTRAINT uq_outbox_event_id UNIQUE,
    tipo_evento    VARCHAR(60)  NOT NULL,
    agregado_id    VARCHAR(60)  NOT NULL,
    payload        JSONB        NOT NULL,
    correlation_id VARCHAR(100) NOT NULL,
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    publicado_en   TIMESTAMPTZ,
    intentos       INT          NOT NULL DEFAULT 0 CONSTRAINT ck_outbox_intentos CHECK (intentos >= 0),
    ultimo_error   VARCHAR(500)
);
CREATE INDEX ix_outbox_pendientes ON outbox (creado_en) WHERE publicado_en IS NULL;
