-- ============================================================================
--  TOURGIRLS  ·  ms_billing_profile  ·  Billing Profile Service (REST)
--  Base de datos propia del microservicio 2.
--  Plan: Plan/ms_billing_profile/PLAN_IMPLEMENTACION.md
--  Origen: Plan/02_microservicios_v2_bases_de_datos.sql (seccion 2), sin cambios
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: dato_facturacion
--  Referencias externas (ID logico, sin FK): usu_id -> usuario (Identity)
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_billing_profile.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_billing_profile ENCODING 'UTF8';
\connect ms_billing_profile


CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');

CREATE TABLE dato_facturacion (
    dfa_id                  BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id                  BIGINT       NOT NULL,                   -- ID logico (Identity)
    dfa_tipo_identificacion VARCHAR(20)  NOT NULL DEFAULT 'CEDULA',  -- CEDULA, RUC, PASAPORTE, CONSUMIDOR_FINAL
    dfa_identificacion      VARCHAR(20)  NOT NULL,
    dfa_razon_social        VARCHAR(150) NOT NULL,
    dfa_correo              dom_correo   NOT NULL,
    dfa_telefono            dom_telefono,
    dfa_es_principal        BOOLEAN      NOT NULL DEFAULT FALSE,
    dfa_activo              BOOLEAN      NOT NULL DEFAULT TRUE,      -- borrado logico
    dfa_creado_en           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT dato_facturacion_tipo_valido
        CHECK (dfa_tipo_identificacion IN ('CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL')),
    CONSTRAINT dato_facturacion_identificacion_valida CHECK (
        (dfa_tipo_identificacion = 'CEDULA'           AND dfa_identificacion ~ '^[0-9]{10}$') OR
        (dfa_tipo_identificacion = 'RUC'              AND dfa_identificacion ~ '^[0-9]{13}$') OR
        (dfa_tipo_identificacion = 'PASAPORTE'        AND dfa_identificacion ~ '^[A-Z0-9]{6,20}$') OR
        (dfa_tipo_identificacion = 'CONSUMIDOR_FINAL' AND dfa_identificacion = '9999999999999')
    ),
    CONSTRAINT uq_dato_facturacion_usuario_identificacion
        UNIQUE (usu_id, dfa_tipo_identificacion, dfa_identificacion)
);
CREATE UNIQUE INDEX ux_dato_facturacion_principal
    ON dato_facturacion (usu_id) WHERE dfa_es_principal;
CREATE INDEX ix_dato_facturacion_usu_id ON dato_facturacion (usu_id);

-- Datos de facturacion de los turistas de cliente_api (Identity): cada fila es
-- de un usuario web (usu_id) o de un turista (cla_id), nunca de los dos.
ALTER TABLE dato_facturacion ALTER COLUMN usu_id DROP NOT NULL;
ALTER TABLE dato_facturacion ADD COLUMN cla_id BIGINT;            -- ID logico (Identity, cliente_api TURISTA)
ALTER TABLE dato_facturacion ADD CONSTRAINT dato_facturacion_un_titular
    CHECK ((usu_id IS NOT NULL) <> (cla_id IS NOT NULL));
ALTER TABLE dato_facturacion ADD CONSTRAINT uq_dato_facturacion_cliente_identificacion
    UNIQUE (cla_id, dfa_tipo_identificacion, dfa_identificacion);
CREATE UNIQUE INDEX ux_dato_facturacion_principal_cliente
    ON dato_facturacion (cla_id) WHERE dfa_es_principal AND cla_id IS NOT NULL;
CREATE INDEX ix_dato_facturacion_cla_id ON dato_facturacion (cla_id);
