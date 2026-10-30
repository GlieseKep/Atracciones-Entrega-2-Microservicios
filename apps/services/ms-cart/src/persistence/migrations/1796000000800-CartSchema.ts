import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL literal de Plan/ms_cart/ms_cart.sql. */
const UP = String.raw`CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
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
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('car_actualizado_en');`;

export class CartSchema1796000000800 implements MigrationInterface {
  name = 'CartSchema1796000000800';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE carrito_item');
    await queryRunner.query('DROP TABLE carrito');
    await queryRunner.query('DROP FUNCTION fn_actualizar_timestamp');
  }
}
