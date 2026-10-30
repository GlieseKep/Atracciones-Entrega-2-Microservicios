-- ============================================================================
--  DESCUBRE EC  ·  ms_audit  ·  Audit Service (REST, consumidor de eventos)
--  Base de datos propia del microservicio 16.
--  Plan: Plan/ms_audit/PLAN_IMPLEMENTACION.md
--  Origen: Plan/02_microservicios_v2_bases_de_datos.sql (seccion 16)
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: bitacora
--  Referencias externas (ID logico, sin FK): bitacora.usu_id -> usuario (Identity)
--
--  CAMBIOS RESPECTO AL SCRIPT GENERAL
--  - + bit_event_id: el bus puede entregar un evento dos veces.
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_audit.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_audit ENCODING 'UTF8';
\connect ms_audit


CREATE TABLE bitacora (
    bit_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bit_event_id       UUID        NOT NULL UNIQUE,     -- id del evento del bus
    usu_id             BIGINT,                      -- ID logico (Identity); NULL si es anonimo
    bit_accion         VARCHAR(60) NOT NULL,
    bit_entidad        VARCHAR(60) NOT NULL,
    bit_entidad_id     VARCHAR(64),
    bit_correlation_id VARCHAR(64),                 -- X-Correlation-Id
    bit_detalle        JSONB,
    bit_ip             VARCHAR(45),
    bit_creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_bitacora_usu_id      ON bitacora (usu_id);
CREATE INDEX ix_bitacora_fecha       ON bitacora (bit_creado_en DESC);
CREATE INDEX ix_bitacora_entidad     ON bitacora (bit_entidad, bit_entidad_id);
CREATE INDEX ix_bitacora_correlation ON bitacora (bit_correlation_id);
