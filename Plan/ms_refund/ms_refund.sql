-- ============================================================================
--  DESCUBRE EC  ·  ms_refund  ·  Refund Service (REST)
--  Base de datos propia del microservicio 13.
--  Plan: Plan/ms_refund/PLAN_IMPLEMENTACION.md
--  Origen: Plan/02_microservicios_v2_bases_de_datos.sql (seccion 13)
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: reembolso, outbox
--  Referencias externas (ID logico, sin FK): pag_id -> pago (Payment)
--  rem_numero = reembolso_id del contrato (ej. REF-ATR-7F3K9Q).
--  Regla "no reembolsar mas de lo cobrado": el servicio consulta a Payment el
--  monto cobrado y suma aqui lo ya reembolsado.
--  Publica: ReembolsoEmitido
--
--  CAMBIOS RESPECTO AL SCRIPT GENERAL
--  - + rem_clave_idempotencia: sin ella, un reintento de la saga de cancelacion
--    devolveria el dinero dos veces.
--  - + outbox: la arquitectura exige publicar ReembolsoEmitido.
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_refund.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_refund ENCODING 'UTF8';
\connect ms_refund


CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE TABLE reembolso (
    rem_id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id            BIGINT      NOT NULL,         -- ID logico (Payment)
    rem_numero        VARCHAR(30) NOT NULL UNIQUE,  -- reembolso_id
    rem_monto         dom_importe NOT NULL,         -- monto_reembolsado
    rem_motivo        VARCHAR(300),
    rem_referencia    VARCHAR(100),                 -- id del reembolso en la pasarela
    rem_clave_idempotencia UUID   NOT NULL UNIQUE,      -- cabecera Idempotency-Key
    rem_solicitado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    rem_procesado_en  TIMESTAMPTZ,
    rem_creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reembolso_monto_valido CHECK (rem_monto > 0)
);
CREATE INDEX ix_reembolso_pag_id ON reembolso (pag_id);

-- Transactional Outbox: ReembolsoEmitido.
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
