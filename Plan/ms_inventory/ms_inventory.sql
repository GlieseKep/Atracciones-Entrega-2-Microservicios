-- ============================================================================
--  DESCUBRE EC  ·  ms_inventory  ·  Inventory & Availability Service (gRPC)
--  Base de datos propia del microservicio 7.
--  Plan: Plan/ms_inventory/PLAN_IMPLEMENTACION.md
--  Origen: Plan/02_microservicios_v2_bases_de_datos.sql (seccion 7)
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: horario, disponibilidad, fecha_bloqueada, bloqueo_cupo, outbox
--  Relaciones internas: horario 1-N disponibilidad, disponibilidad 1-N bloqueo_cupo
--  Referencias externas (ID logico, sin FK): atr_codigo -> atraccion (Catalog)
--  disponibilidad es la tabla de turnos y aforo del contrato v3:
--  dis_slot_codigo = slot_id. DISPONIBLE / ULTIMOS_CUPOS (<= 3) / AGOTADO se calcula.
--
--  CAMBIOS RESPECTO AL SCRIPT GENERAL
--  - atr_codigo reemplaza a atr_id: el contrato identifica la atraccion por su id
--    alfanumerico en /atracciones/{id}/disponibilidad y en item_id del gRPC.
--  - + bloqueo_cupo: un reintento de la saga no debe descontar los cupos dos veces.
--  - + outbox: la arquitectura exige publicar CupoBloqueado y CupoLiberado, y enviar
--    cada cambio de cupo a Booking Prototipo sin perderlo.
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_inventory.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_inventory ENCODING 'UTF8';
\connect ms_inventory


CREATE TABLE horario (
    hor_id     BIGINT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo CHAR(12) NOT NULL,                  -- ID logico (Catalog): id del contrato
    hor_hora   TIME    NOT NULL,
    hor_cupo   INTEGER NOT NULL DEFAULT 20,
    hor_activo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT horario_cupo_positivo CHECK (hor_cupo > 0),
    CONSTRAINT uq_horario_atraccion_hora UNIQUE (atr_codigo, hor_hora),
    -- Clave candidata para la FK compuesta desde disponibilidad
    CONSTRAINT uq_horario_id_atraccion UNIQUE (hor_id, atr_codigo)
);
CREATE INDEX ix_horario_atr_codigo ON horario (atr_codigo);

CREATE TABLE disponibilidad (
    dis_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo         CHAR(12)    NOT NULL,        -- ID logico (Catalog): id del contrato
    hor_id             BIGINT      NOT NULL,
    dis_fecha          DATE        NOT NULL,
    dis_slot_codigo    VARCHAR(40) NOT NULL,        -- slot_id, ej. slot-20261025-1030
    dis_cupo_total     INTEGER     NOT NULL,
    dis_cupo_reservado INTEGER     NOT NULL DEFAULT 0,
    dis_cerrada        BOOLEAN     NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_disponibilidad_atraccion_fecha_horario UNIQUE (atr_codigo, dis_fecha, hor_id),
    CONSTRAINT uq_disponibilidad_atraccion_slot UNIQUE (atr_codigo, dis_slot_codigo),
    -- La fecha del slot_id debe coincidir con dis_fecha (SLOT_TIME_MISMATCH);
    -- la hora la valida el servicio contra horario.hor_hora.
    CONSTRAINT disponibilidad_slot_formato
        CHECK (dis_slot_codigo = 'slot-' || to_char(dis_fecha, 'YYYYMMDD') || '-' || right(dis_slot_codigo, 4)
               AND dis_slot_codigo ~ '^slot-[0-9]{8}-[0-9]{4}$'),
    CONSTRAINT disponibilidad_cupos_validos
        CHECK (dis_cupo_total > 0
               AND dis_cupo_reservado >= 0
               AND dis_cupo_reservado <= dis_cupo_total),
    -- FK compuesta interna: el horario debe ser de la MISMA atraccion
    CONSTRAINT fk_disponibilidad_horario
        FOREIGN KEY (hor_id, atr_codigo) REFERENCES horario (hor_id, atr_codigo)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_disponibilidad_atr_codigo ON disponibilidad (atr_codigo);
CREATE INDEX ix_disponibilidad_hor_id ON disponibilidad (hor_id, atr_codigo);
CREATE INDEX ix_disponibilidad_fecha  ON disponibilidad (dis_fecha);

CREATE TABLE fecha_bloqueada (
    fb_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo   CHAR(12)     NOT NULL,             -- ID logico (Catalog): id del contrato
    fb_fecha     DATE         NOT NULL,
    fb_motivo    VARCHAR(200) NOT NULL,
    fb_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_fecha_bloqueada_atraccion_fecha UNIQUE (atr_codigo, fb_fecha)
);
CREATE INDEX ix_fecha_bloqueada_atr_codigo ON fecha_bloqueada (atr_codigo);

-- Cupos descontados por una reserva. La clave hace idempotentes el descuento y su reintegro.
CREATE TABLE bloqueo_cupo (
    blo_id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dis_id          BIGINT       NOT NULL,
    blo_clave       VARCHAR(120) NOT NULL UNIQUE,
    blo_cantidad    INTEGER      NOT NULL,
    blo_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    blo_liberado_en TIMESTAMPTZ,
    CONSTRAINT bloqueo_cupo_cantidad_valida CHECK (blo_cantidad > 0),
    CONSTRAINT fk_bloqueo_cupo_disponibilidad
        FOREIGN KEY (dis_id) REFERENCES disponibilidad (dis_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_bloqueo_cupo_dis_id ON bloqueo_cupo (dis_id);

-- Transactional Outbox: CupoBloqueado, CupoLiberado y envio de stock a Booking Prototipo.
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
