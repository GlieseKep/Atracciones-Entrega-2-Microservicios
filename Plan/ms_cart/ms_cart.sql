-- ============================================================================
--  DESCUBRE EC  ·  ms_cart  ·  Cart Service (REST)
--  Base de datos propia del microservicio 8.
--  Plan: Plan/ms_cart/PLAN_IMPLEMENTACION.md
--  Contrato: Plan/ms_cart/ms_cart-openapi.yaml
--  Origen: script propio, indicado en la seccion 8 de
--          Plan/02_microservicios_v2_bases_de_datos.sql
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  Tablas: carrito, carrito_item
--  Relaciones internas: carrito 1-N carrito_item
--  Referencias externas (ID logico, sin FK):
--    carrito.usu_id                -> usuario (Identity)
--    carrito_item.atr_codigo       -> atraccion.codigo_publico (Catalog)
--    carrito_item.dis_slot_codigo  -> disponibilidad.dis_slot_codigo (Inventory)
--    carrito_item.cai_ord_numero   -> orden.ord_numero (Order)
--
--  REGLA DE COMPRA
--  Cada atraccion se paga por separado: una transaccion compra UN solo item
--  del carrito y ese item pasa a UNA orden (orden.cai_id en Order). Los
--  demas items siguen en el carrito sin pagar. Ciclo de vida del item:
--
--    PENDIENTE --(Order crea la orden)--> EN_PAGO --(pago aprobado)--> COMPRADO
--        ^                                   |
--        +------(pago rechazado o fallido)---+
--
--  - PENDIENTE: en el carrito; el usuario lo puede editar o quitar.
--  - EN_PAGO:   ligado a una orden mientras se cobra; no se puede editar.
--  - COMPRADO:  pago aprobado; ya no se muestra en el carrito.
--  Order solo marca el item COMPRADO despues de validar que el pago fue
--  exitoso; recien entonces la orden puede pasar a factura (Invoicing).
--
--  DISENO
--  - carrito_item guarda los identificadores publicos del contrato v3
--    (attraction_id = atr_codigo, slot_id = dis_slot_codigo), para responder
--    sin consultar a Catalog ni a Inventory en cada lectura.
--  - Unicidad atraccion + turno con dos indices parciales, porque una UNIQUE
--    con slot NULL no impide duplicados. Los items COMPRADOS no cuentan: se
--    puede volver a agregar la misma atraccion.
--
--  CAMBIOS RESPECTO AL SCRIPT PROPIO
--  - carrito.usu_id pasa de VARCHAR(64) a BIGINT, como en todos los servicios.
--
--  EJECUCION (con psql, como superusuario)
--     psql -U postgres -f ms_cart.sql
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_cart ENCODING 'UTF8';
\connect ms_cart

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Cabecera del carrito. Un usuario tiene un carrito activo; car_activo pasa
-- a FALSE solo cuando el carrito se abandona (sin cambios por N dias). Pagar
-- un item NO desactiva el carrito.
CREATE TABLE carrito (
    car_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id             BIGINT      NOT NULL,            -- ID logico (Identity)
    car_activo         BOOLEAN     NOT NULL DEFAULT TRUE,
    car_creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    car_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_carrito_usu_id ON carrito (usu_id);
-- Solo UN carrito activo por usuario.
CREATE UNIQUE INDEX ux_carrito_activo ON carrito (usu_id) WHERE car_activo;

-- Linea del carrito: una atraccion, un turno opcional y las cantidades por
-- tipo de boleto (mismos campos que CreateReservaRequestV3).
CREATE TABLE carrito_item (
    cai_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    car_id             BIGINT      NOT NULL,
    atr_codigo         CHAR(12)    NOT NULL,                -- attraction_id: codigo publico (Catalog)
    dis_slot_codigo    VARCHAR(40),                         -- slot_id (Inventory), opcional
    cai_adultos        INTEGER     NOT NULL DEFAULT 1,      -- adult_count
    cai_ninos          INTEGER     NOT NULL DEFAULT 0,      -- child_count
    cai_seniors        INTEGER     NOT NULL DEFAULT 0,      -- senior_count
    cai_estudiantes    INTEGER     NOT NULL DEFAULT 0,      -- student_count
    cai_infantes       INTEGER     NOT NULL DEFAULT 0,      -- infant_count
    -- Compra del item (una atraccion = una orden)
    cai_estado         VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE',  -- PENDIENTE, EN_PAGO, COMPRADO
    cai_ord_numero     VARCHAR(20),                         -- external_order_id (Order)
    cai_orden_clave    UUID,                                -- Idempotency-Key de la compra
    cai_en_pago_desde  TIMESTAMPTZ,
    cai_comprado_en    TIMESTAMPTZ,
    cai_creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT carrito_item_cantidades_validas
        CHECK (cai_adultos >= 1 AND cai_ninos >= 0 AND cai_seniors >= 0
               AND cai_estudiantes >= 0 AND cai_infantes >= 0),
    CONSTRAINT carrito_item_atr_codigo_formato
        CHECK (atr_codigo ~ '^[A-Za-z0-9]{12}$'),
    CONSTRAINT carrito_item_slot_formato
        CHECK (dis_slot_codigo IS NULL OR dis_slot_codigo ~ '^slot-[0-9]{8}-[0-9]{4}$'),
    CONSTRAINT carrito_item_estado_valido
        CHECK (cai_estado IN ('PENDIENTE', 'EN_PAGO', 'COMPRADO')),
    -- Los datos de la compra deben coincidir con el estado; no se paga sin turno.
    CONSTRAINT carrito_item_compra_coherente CHECK (
        (cai_estado = 'PENDIENTE'
            AND cai_ord_numero IS NULL AND cai_orden_clave IS NULL
            AND cai_en_pago_desde IS NULL AND cai_comprado_en IS NULL)
     OR (cai_estado = 'EN_PAGO'
            AND dis_slot_codigo IS NOT NULL
            AND cai_ord_numero IS NOT NULL AND cai_orden_clave IS NOT NULL
            AND cai_en_pago_desde IS NOT NULL AND cai_comprado_en IS NULL)
     OR (cai_estado = 'COMPRADO'
            AND dis_slot_codigo IS NOT NULL
            AND cai_ord_numero IS NOT NULL AND cai_orden_clave IS NOT NULL
            AND cai_en_pago_desde IS NOT NULL AND cai_comprado_en IS NOT NULL)
    ),
    -- Una orden corresponde a un solo item (y a una sola atraccion).
    CONSTRAINT uq_carrito_item_ord_numero UNIQUE (cai_ord_numero),
    CONSTRAINT fk_carrito_item_carrito
        FOREIGN KEY (car_id) REFERENCES carrito (car_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_carrito_item_car_id ON carrito_item (car_id);
CREATE INDEX ix_carrito_item_atr_codigo ON carrito_item (atr_codigo);
-- Items que siguen EN_PAGO: para liberar los que se quedaron colgados.
CREATE INDEX ix_carrito_item_en_pago
    ON carrito_item (cai_en_pago_desde) WHERE cai_estado = 'EN_PAGO';
-- Un item por atraccion + turno dentro del carrito (y uno solo sin turno);
-- los items ya comprados no cuentan.
CREATE UNIQUE INDEX ux_carrito_item_con_turno
    ON carrito_item (car_id, atr_codigo, dis_slot_codigo)
    WHERE dis_slot_codigo IS NOT NULL AND cai_estado <> 'COMPRADO';
CREATE UNIQUE INDEX ux_carrito_item_sin_turno
    ON carrito_item (car_id, atr_codigo)
    WHERE dis_slot_codigo IS NULL AND cai_estado <> 'COMPRADO';

CREATE TRIGGER trg_carrito_actualizado BEFORE UPDATE ON carrito
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('car_actualizado_en');
