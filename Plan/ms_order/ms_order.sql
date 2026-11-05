-- ============================================================================
--  TOURGIRLS  ·  ms_order  ·  Order Management Service (gRPC)
--  Base de datos propia del microservicio 10.
--  Plan: Plan/ms_order/PLAN_IMPLEMENTACION.md
--  Origen: Plan/02_microservicios_v2_bases_de_datos.sql (seccion 10)
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: estado, orden, orden_detalle, orden_cupon, idempotencia, outbox
--  Referencias externas (ID logico, sin FK): usu_id, cla_id -> Identity;
--    cai_id -> carrito_item (Cart); mpa_id -> metodo_pago (Payment);
--    atr_id -> atraccion (Catalog); cup_id -> cupon (Coupon)
--  external_order_id del contrato = orden.ord_numero.
--
--  CAMBIOS RESPECTO AL SCRIPT GENERAL
--  - + outbox: la arquitectura exige publicar OrdenCreada y OrdenPagada.
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_order.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_order ENCODING 'UTF8';
\connect ms_order


CREATE DOMAIN dom_moneda AS CHAR(3)
    CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Estados propios de la orden (sin est_grupo).
CREATE TABLE estado (
    est_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    est_codigo VARCHAR(20) NOT NULL UNIQUE,
    est_nombre VARCHAR(50) NOT NULL,
    est_final  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE orden (
    ord_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_numero         VARCHAR(20) NOT NULL UNIQUE,  -- external_order_id (ej. ORD-DILAN-8721)
    -- Canal de la orden: un usuario de la web O un cliente API (Booking).
    usu_id             BIGINT,                       -- ID logico (Identity), comprador web
    cla_id             BIGINT,                       -- ID logico (Identity), canal B2B
    cai_id             BIGINT,                       -- ID logico (Cart): item del carrito; NULL = compra directa
    est_id             SMALLINT    NOT NULL,
    mpa_id             SMALLINT,                     -- ID logico (Payment)
    ord_fecha          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ord_subtotal       dom_importe NOT NULL DEFAULT 0,
    ord_descuento      dom_importe NOT NULL DEFAULT 0,
    ord_iva            dom_importe NOT NULL DEFAULT 0,
    ord_total          dom_importe NOT NULL DEFAULT 0,
    ord_moneda         dom_moneda  NOT NULL DEFAULT 'USD',
    ord_observaciones  VARCHAR(500),
    ord_creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ord_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT orden_total_coherente
        CHECK (ord_total = ord_subtotal - ord_descuento + ord_iva),
    -- Exactamente uno de los dos: la orden es de la web o del canal B2B.
    CONSTRAINT orden_canal_unico
        CHECK ((usu_id IS NOT NULL) <> (cla_id IS NOT NULL)),
    -- Un item del carrito pasa a UNA sola orden.
    CONSTRAINT uq_orden_cai_id UNIQUE (cai_id),
    CONSTRAINT fk_orden_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_orden_usu_id ON orden (usu_id);
CREATE INDEX ix_orden_cla_id ON orden (cla_id);
CREATE INDEX ix_orden_est_id ON orden (est_id);
CREATE INDEX ix_orden_fecha  ON orden (ord_fecha DESC);
CREATE INDEX ix_orden_mpa_id ON orden (mpa_id);

CREATE TABLE orden_detalle (
    det_id              BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_id              BIGINT       NOT NULL,
    atr_id              BIGINT       NOT NULL,       -- ID logico (Catalog)
    det_descripcion     VARCHAR(255) NOT NULL,       -- snapshot del nombre
    det_cantidad        INTEGER      NOT NULL,
    det_precio_unitario dom_importe  NOT NULL,       -- snapshot del precio (Pricing)
    det_subtotal        dom_importe  NOT NULL,
    CONSTRAINT orden_detalle_cantidad_valida CHECK (det_cantidad > 0),
    CONSTRAINT orden_detalle_subtotal_coherente
        CHECK (det_subtotal = det_cantidad * det_precio_unitario),
    CONSTRAINT fk_orden_detalle_orden
        FOREIGN KEY (ord_id) REFERENCES orden (ord_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_orden_detalle_ord_id ON orden_detalle (ord_id);
CREATE INDEX ix_orden_detalle_atr_id ON orden_detalle (atr_id);

-- Una orden = una atraccion: todas las lineas de una orden deben ser de la
-- misma atraccion (no se compran dos atracciones en una transaccion).
CREATE OR REPLACE FUNCTION fn_orden_detalle_una_atraccion()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM orden_detalle
               WHERE ord_id = NEW.ord_id AND atr_id <> NEW.atr_id AND det_id <> NEW.det_id) THEN
        RAISE EXCEPTION 'La orden % ya tiene otra atraccion: cada atraccion se paga por separado', NEW.ord_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orden_detalle_una_atraccion
    BEFORE INSERT OR UPDATE OF ord_id, atr_id ON orden_detalle
    FOR EACH ROW EXECUTE FUNCTION fn_orden_detalle_una_atraccion();

CREATE TABLE orden_cupon (
    ord_id       BIGINT      NOT NULL,
    cup_id       BIGINT      NOT NULL,               -- ID logico (Coupon)
    orc_usado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_orden_cupon PRIMARY KEY (ord_id, cup_id),
    CONSTRAINT fk_orden_cupon_orden
        FOREIGN KEY (ord_id) REFERENCES orden (ord_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_orden_cupon_cup_id ON orden_cupon (cup_id);

-- Registro de operaciones idempotentes (evita cobros dobles).
-- El sujeto es un usuario web (JWT) o un cliente API (X-API-Key).
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

CREATE TRIGGER trg_orden_actualizado BEFORE UPDATE ON orden
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('ord_actualizado_en');

CREATE VIEW v_orden_financiero AS
SELECT o.ord_id, o.ord_numero, o.ord_fecha, o.usu_id, o.cla_id,
       COALESCE(SUM(det.det_subtotal), 0) AS calculado_subtotal,
       o.ord_subtotal, o.ord_descuento, o.ord_iva, o.ord_total,
       (o.ord_subtotal - o.ord_descuento + o.ord_iva) AS total_recalculado
FROM orden o
LEFT JOIN orden_detalle det ON det.ord_id = o.ord_id
GROUP BY o.ord_id, o.ord_numero, o.ord_fecha, o.usu_id, o.cla_id,
         o.ord_subtotal, o.ord_descuento, o.ord_iva, o.ord_total;

INSERT INTO estado (est_codigo, est_nombre, est_final) VALUES
    ('CREADA',      'Orden creada',      FALSE),
    ('PAGADA',      'Orden pagada',      TRUE),
    ('CANCELADA',   'Orden cancelada',   TRUE),
    ('REEMBOLSADA', 'Orden reembolsada', TRUE);

-- Transactional Outbox: OrdenCreada y OrdenPagada.
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
