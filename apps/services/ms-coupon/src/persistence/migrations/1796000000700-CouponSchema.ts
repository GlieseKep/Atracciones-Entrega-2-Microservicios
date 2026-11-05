import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL y acuerdo inicial literales de Plan/ms_coupon/ms_coupon.sql. */
const UP = String.raw`CREATE DOMAIN dom_correo AS VARCHAR(160)
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

-- Cupones de descuento del portal.
CREATE TABLE cupon (
    cup_id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cup_codigo       VARCHAR(30) NOT NULL UNIQUE,   -- code
    cup_tipo         VARCHAR(20) NOT NULL,          -- type: PORCENTAJE, FIJO
    cup_valor        dom_importe NOT NULL,          -- value
    cup_fecha_inicio DATE        NOT NULL,          -- start_date
    cup_fecha_fin    DATE,                          -- end_date (NULL = sin fin)
    cup_usos_max     INTEGER,                       -- max_uses (NULL = sin limite)
    cup_activo       BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT cupon_codigo_formato CHECK (cup_codigo ~ '^[A-Z0-9_-]{3,30}$'),
    CONSTRAINT cupon_tipo_valido CHECK (cup_tipo IN ('PORCENTAJE', 'FIJO')),
    CONSTRAINT cupon_vigencia_valida
        CHECK (cup_fecha_fin IS NULL OR cup_fecha_fin >= cup_fecha_inicio),
    CONSTRAINT cupon_usos_valido
        CHECK (cup_usos_max IS NULL OR cup_usos_max > 0),
    CONSTRAINT cupon_porcentaje_valido
        CHECK (cup_tipo <> 'PORCENTAJE' OR cup_valor <= 100)
);
CREATE INDEX ix_cupon_activo ON cupon (cup_activo);

-- Acuerdo comercial B2B con Booking Prototipo (PromocionesContratoResponse).
CREATE TABLE acuerdo_promocion (
    apr_id                       SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    apr_proveedor_codigo         VARCHAR(60)  NOT NULL UNIQUE,   -- proveedor_id
    apr_nombre_comercial         VARCHAR(150),                   -- nombre_comercial
    apr_permite_promociones      BOOLEAN      NOT NULL,          -- pregunta 1
    apr_porcentaje_descuento_max NUMERIC(5,2) NOT NULL DEFAULT 0, -- pregunta 2 (0-50 %)
    apr_fecha_acuerdo            DATE         NOT NULL DEFAULT CURRENT_DATE,
    apr_vigencia_hasta           DATE         NOT NULL,          -- vigencia_hasta (obligatorio en la respuesta)
    apr_condiciones_combo        VARCHAR(500),                   -- condiciones_combo
    apr_contacto_nombre          VARCHAR(120),                   -- contacto_comercial.nombre
    apr_contacto_correo          dom_correo,                     -- contacto_comercial.email
    apr_contacto_telefono        dom_telefono,                   -- contacto_comercial.telefono
    apr_actualizado_en           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT acuerdo_promocion_porcentaje_valido
        CHECK (apr_porcentaje_descuento_max BETWEEN 0 AND 50),
    CONSTRAINT acuerdo_promocion_vigencia_valida
        CHECK (apr_vigencia_hasta >= apr_fecha_acuerdo)
);

-- destinos_habilitados: ciudades donde aplica la promocion.
CREATE TABLE acuerdo_promocion_destino (
    apr_id SMALLINT NOT NULL,
    ciu_id SMALLINT NOT NULL,                        -- ID logico (Location)
    CONSTRAINT pk_acuerdo_promocion_destino PRIMARY KEY (apr_id, ciu_id),
    CONSTRAINT fk_acuerdo_promocion_destino_acuerdo
        FOREIGN KEY (apr_id) REFERENCES acuerdo_promocion (apr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_acuerdo_promocion_destino_ciu_id ON acuerdo_promocion_destino (ciu_id);

CREATE TRIGGER trg_acuerdo_promocion_actualizado BEFORE UPDATE ON acuerdo_promocion
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('apr_actualizado_en');

-- Acuerdo inicial: sin promociones hasta que el administrador responda el
-- cuestionario con PUT /atracciones/promociones/contrato.
INSERT INTO acuerdo_promocion
    (apr_proveedor_codigo, apr_nombre_comercial, apr_permite_promociones,
     apr_porcentaje_descuento_max, apr_vigencia_hasta)
VALUES
    ('proveedor-atracciones-dilan', 'TourGirls', FALSE, 0,
     (CURRENT_DATE + INTERVAL '1 year')::date);`;

const DOWN = [
  'DROP TABLE acuerdo_promocion_destino',
  'DROP TABLE acuerdo_promocion',
  'DROP TABLE cupon',
  'DROP FUNCTION fn_actualizar_timestamp',
  'DROP DOMAIN dom_importe',
  'DROP DOMAIN dom_telefono',
  'DROP DOMAIN dom_correo',
];

export class CouponSchema1796000000700 implements MigrationInterface {
  name = 'CouponSchema1796000000700';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of DOWN) await queryRunner.query(sentence);
  }
}
