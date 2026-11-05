-- ============================================================================
--  TOURGIRLS  ·  ms_booking  ·  Booking Service (gRPC + REST /atracciones/reservas)
--  Base de datos propia del microservicio 11.
--  Plan: Plan/ms_booking/PLAN_IMPLEMENTACION.md
--  Origen: Plan/02_microservicios_v2_bases_de_datos.sql (seccion 11)
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: estado, reserva, reserva_pasajero, idempotencia, outbox_evento
--  Relaciones internas: estado 1-N reserva, reserva 1-N reserva_pasajero
--  Referencias externas (ID logico, sin FK): det_id y ord_numero -> Order;
--    dis_id -> disponibilidad (Inventory); gui_id -> guia (Catalog);
--    idem_sujeto -> usuario o cliente_api (Identity)
--  La fecha, la hora y el slot_id se leen de disponibilidad (3FN).
--
--  CAMBIOS RESPECTO AL SCRIPT GENERAL (todos los exige el contrato v3)
--  - ord_numero: external_order_id es obligatorio en ReservaConfirmadaResponseV2.
--  - res_reembolso_id y res_monto_reembolsado: la respuesta de la cancelacion los devuelve.
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_booking.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_booking ENCODING 'UTF8';
\connect ms_booking


CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Estados de la reserva = enum status del contrato v3 (maquina de 6 fases).
CREATE TABLE estado (
    est_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    est_codigo VARCHAR(20) NOT NULL UNIQUE,
    est_nombre VARCHAR(50) NOT NULL,
    est_final  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE reserva (
    res_id                 BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    res_uuid               UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- reservation_id
    res_codigo             VARCHAR(12)   NOT NULL UNIQUE,   -- reservation_code (PNR), ej. DEC-7F3K9Q
    ord_numero             VARCHAR(20)   NOT NULL UNIQUE,   -- external_order_id (Order)
    det_id                 BIGINT        NOT NULL,          -- ID logico (Order)
    dis_id                 BIGINT        NOT NULL,          -- ID logico (Inventory)
    est_id                 SMALLINT      NOT NULL,
    gui_id                 BIGINT,                          -- ID logico (Catalog); NULL = sin guia
    res_saga_id            VARCHAR(40),                     -- saga_id de Booking Prototipo
    res_adultos            INTEGER       NOT NULL,          -- adult_count
    res_ninos              INTEGER       NOT NULL DEFAULT 0, -- child_count
    res_seniors            INTEGER       NOT NULL DEFAULT 0, -- senior_count
    res_estudiantes        INTEGER       NOT NULL DEFAULT 0, -- student_count
    res_infantes           INTEGER       NOT NULL DEFAULT 0, -- infant_count (ocupa cupo)
    res_numero_tickets     INTEGER       NOT NULL,          -- ticket_count
    res_precio_total       dom_importe   NOT NULL,          -- total_price (snapshot)
    res_requerimientos     VARCHAR(500),                    -- special_requirements
    res_voucher_qr         TEXT,                            -- voucher_qr_payload (firmado)
    -- Cancelacion (POST /reservas/{id}/cancel)
    res_motivo_cancelacion VARCHAR(255),                    -- reason
    res_cancelado_por      VARCHAR(20),                     -- solicitante
    res_cancelado_en       TIMESTAMPTZ,
    res_reembolso_id       VARCHAR(30),                     -- reembolso_id (Refund)
    res_monto_reembolsado  dom_importe,                     -- monto_reembolsado
    -- Check-in presencial (POST /reservas/{id}/checkin)
    res_checkin_en         TIMESTAMPTZ,                     -- hora_checkin
    res_checkin_documento  VARCHAR(20),                     -- documento_identidad presentado
    res_checkin_guia_codigo VARCHAR(30),                    -- guia_codigo
    res_checkin_dispositivo VARCHAR(60),                    -- scanner_device_id
    res_confirmado_en      TIMESTAMPTZ,
    res_creado_en          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    res_actualizado_en     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT reserva_reembolso_coherente
        CHECK ((res_reembolso_id IS NULL) = (res_monto_reembolsado IS NULL)),
    CONSTRAINT reserva_pasajeros_validos
        CHECK (res_adultos >= 1 AND res_ninos >= 0 AND res_seniors >= 0
               AND res_estudiantes >= 0 AND res_infantes >= 0),
    CONSTRAINT reserva_total_coherente
        CHECK (res_numero_tickets = res_adultos + res_ninos + res_seniors
                                  + res_estudiantes + res_infantes),
    CONSTRAINT reserva_cancelado_por_valido
        CHECK (res_cancelado_por IS NULL
               OR res_cancelado_por IN ('CLIENTE', 'SAGA_ORCHESTRATOR', 'ADMIN')),
    CONSTRAINT reserva_cancelacion_coherente
        CHECK ((res_cancelado_en IS NULL) = (res_cancelado_por IS NULL)),
    CONSTRAINT reserva_checkin_coherente
        CHECK (res_checkin_en IS NULL OR res_checkin_documento IS NOT NULL),
    CONSTRAINT reserva_no_checkin_y_cancelada
        CHECK (res_checkin_en IS NULL OR res_cancelado_en IS NULL),
    CONSTRAINT fk_reserva_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_reserva_det_id  ON reserva (det_id);
CREATE INDEX ix_reserva_dis_id  ON reserva (dis_id);
CREATE INDEX ix_reserva_gui_id  ON reserva (gui_id);
CREATE INDEX ix_reserva_est_id  ON reserva (est_id);
CREATE INDEX ix_reserva_saga_id ON reserva (res_saga_id);

-- Pasajeros de la reserva. El titular (customer del contrato) lleva sus
-- datos de contacto; los acompanantes (passengers) solo nombre, documento
-- y tipo de boleto.
CREATE TABLE reserva_pasajero (
    pax_id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    res_id               BIGINT       NOT NULL,
    pax_nombre           VARCHAR(120) NOT NULL,     -- full_name
    pax_tipo_documento   VARCHAR(10),               -- document_type: CEDULA, PASAPORTE, RUC
    pax_documento        VARCHAR(20),               -- document_id
    pax_correo           dom_correo,                -- email (titular)
    pax_telefono         dom_telefono,              -- phone (titular)
    pax_tipo_boleto      VARCHAR(10)  NOT NULL DEFAULT 'ADULT', -- ticket_type
    pax_fecha_nacimiento DATE,
    pax_es_titular       BOOLEAN      NOT NULL DEFAULT FALSE,
    CONSTRAINT reserva_pasajero_tipo_boleto_valido
        CHECK (pax_tipo_boleto IN ('ADULT', 'CHILD', 'SENIOR', 'INFANT', 'STUDENT')),
    CONSTRAINT reserva_pasajero_tipo_documento_valido
        CHECK (pax_tipo_documento IS NULL
               OR pax_tipo_documento IN ('CEDULA', 'PASAPORTE', 'RUC')),
    CONSTRAINT reserva_pasajero_documento_valido CHECK (
        pax_documento IS NULL OR
        (pax_tipo_documento = 'CEDULA'    AND pax_documento ~ '^[0-9]{10}$') OR
        (pax_tipo_documento = 'RUC'       AND pax_documento ~ '^[0-9]{13}$') OR
        (pax_tipo_documento = 'PASAPORTE' AND pax_documento ~ '^[A-Z0-9]{6,9}$') OR
        (pax_tipo_documento IS NULL       AND pax_documento ~ '^[A-Z0-9]{6,13}$')
    ),
    -- El titular debe tener todos los datos obligatorios de CustomerContactDto
    CONSTRAINT reserva_pasajero_titular_completo CHECK (
        NOT pax_es_titular OR (pax_tipo_documento IS NOT NULL AND pax_documento IS NOT NULL
                               AND pax_correo IS NOT NULL AND pax_telefono IS NOT NULL)
    ),
    CONSTRAINT fk_reserva_pasajero_reserva
        FOREIGN KEY (res_id) REFERENCES reserva (res_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_reserva_pasajero_res_id ON reserva_pasajero (res_id);
CREATE INDEX ix_reserva_pasajero_documento ON reserva_pasajero (pax_documento);
CREATE INDEX ix_reserva_pasajero_correo ON reserva_pasajero (lower(pax_correo));
-- Un solo titular por reserva.
CREATE UNIQUE INDEX ux_reserva_pasajero_titular
    ON reserva_pasajero (res_id) WHERE pax_es_titular;

-- Idempotencia de POST /reservas, /cancel y /checkin (cabecera obligatoria).
CREATE TABLE idempotencia (
    idem_clave        UUID         NOT NULL,         -- cabecera Idempotency-Key
    idem_sujeto_tipo  VARCHAR(12)  NOT NULL,         -- USUARIO, CLIENTE_API
    idem_sujeto       BIGINT       NOT NULL,         -- ID logico usu_id / cla_id (Identity)
    idem_operacion    VARCHAR(150) NOT NULL,
    idem_request_hash VARCHAR(64)  NOT NULL,
    idem_estado       VARCHAR(12)  NOT NULL DEFAULT 'IN_PROGRESS',
    idem_response     JSONB,
    idem_expira_en    TIMESTAMPTZ  NOT NULL,         -- 24 h segun el contrato
    idem_creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_idempotencia PRIMARY KEY (idem_clave, idem_sujeto_tipo, idem_sujeto),
    CONSTRAINT idempotencia_sujeto_tipo_valido
        CHECK (idem_sujeto_tipo IN ('USUARIO', 'CLIENTE_API')),
    CONSTRAINT idempotencia_estado_valido
        CHECK (idem_estado IN ('IN_PROGRESS', 'DONE', 'FAILED'))
);
CREATE INDEX ix_idempotencia_expira_en ON idempotencia (idem_expira_en);

-- Transactional Outbox (OutboxEventItem, CloudEvents v1.0).
-- evt_id es el sequence_number y el cursor "after" de GET /atracciones/eventos.
CREATE TABLE outbox_evento (
    evt_id             BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- sequence_number
    evt_uuid           UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- event_id
    evt_specversion    VARCHAR(5)   NOT NULL DEFAULT '1.0',
    evt_fuente         VARCHAR(120) NOT NULL DEFAULT '/api/v3/atracciones',   -- source
    evt_tipo           VARCHAR(30)  NOT NULL,                                 -- event_type
    evt_aggregate_id   VARCHAR(64)  NOT NULL,                                 -- aggregate_id
    evt_correlation_id VARCHAR(64)  NOT NULL,                                 -- correlation_id
    evt_payload        JSONB        NOT NULL,                                 -- payload / data
    evt_creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),                   -- timestamp
    evt_publicado_en   TIMESTAMPTZ,                     -- enviado a RabbitMQ / Kafka
    CONSTRAINT outbox_evento_tipo_valido
        CHECK (evt_tipo IN ('RESERVA_CREADA', 'RESERVA_CONFIRMADA',
                            'STOCK_ACTUALIZADO', 'RESERVA_CANCELADA'))
);
CREATE INDEX ix_outbox_evento_tipo ON outbox_evento (evt_tipo, evt_id);
CREATE INDEX ix_outbox_evento_pendiente
    ON outbox_evento (evt_id) WHERE evt_publicado_en IS NULL;

CREATE TRIGGER trg_reserva_actualizado BEFORE UPDATE ON reserva
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('res_actualizado_en');

INSERT INTO estado (est_codigo, est_nombre, est_final) VALUES
    ('PENDING',    'Reserva pendiente',             FALSE),
    ('CONFIRMED',  'Reserva confirmada',            FALSE),
    ('CHECKED_IN', 'Check-in presencial realizado', FALSE),
    ('COMPLETED',  'Reserva completada',            TRUE),
    ('CANCELLED',  'Reserva cancelada',             TRUE),
    ('EXPIRED',    'Reserva expirada',              TRUE);

-- Turista de la reserva (cliente_api de Identity, solo compras de un socio),
-- canal de compra y aviso del check-in a Booking Central (con reintentos).
ALTER TABLE reserva ADD COLUMN cla_id_cliente BIGINT;   -- ID logico (Identity, cliente_api TURISTA); NULL en compras web
ALTER TABLE reserva ADD COLUMN res_canal VARCHAR(10) NOT NULL DEFAULT 'WEB'
    CONSTRAINT reserva_canal_valido CHECK (res_canal IN ('WEB', 'SOCIO'));
CREATE INDEX ix_reserva_cla_id_cliente ON reserva (cla_id_cliente);

CREATE TABLE notificacion_checkin (
    res_id            BIGINT       PRIMARY KEY
        CONSTRAINT fk_notificacion_checkin_reserva REFERENCES reserva (res_id) ON DELETE CASCADE,
    nch_payload       JSONB        NOT NULL,             -- cuerpo de POST /api/v3/reservas/{external_order_id}/checkin
    nch_intentos      INTEGER      NOT NULL DEFAULT 0,
    nch_ultimo_error  VARCHAR(500),
    nch_proximo_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    nch_enviado_en    TIMESTAMPTZ,
    nch_creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    nch_correlation_id VARCHAR(100),                     -- para seguir los reintentos en los logs
    CONSTRAINT notificacion_checkin_intentos_validos CHECK (nch_intentos >= 0)
);
CREATE INDEX ix_notificacion_checkin_pendiente ON notificacion_checkin (nch_proximo_en) WHERE nch_enviado_en IS NULL;
