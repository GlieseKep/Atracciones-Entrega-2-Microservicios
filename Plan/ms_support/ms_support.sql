-- ============================================================================
--  TOURGIRLS  ·  ms_support  ·  Support Service (REST)
--  Base de datos propia del microservicio 15.
--  Plan: Plan/ms_support/PLAN_IMPLEMENTACION.md
--  Origen: Plan/02_microservicios_v2_bases_de_datos.sql (seccion 15), sin cambios
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: mensaje_contacto
--  Referencias externas: ninguna
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_support.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_support ENCODING 'UTF8';
\connect ms_support


CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE TABLE mensaje_contacto (
    men_id        BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    men_nombre    VARCHAR(120)  NOT NULL,
    men_correo    dom_correo    NOT NULL,
    men_asunto    VARCHAR(30)   NOT NULL,
    men_cuerpo    VARCHAR(2000) NOT NULL,
    men_leido     BOOLEAN       NOT NULL DEFAULT FALSE,
    men_creado_en TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_mensaje_contacto_leido ON mensaje_contacto (men_leido);
