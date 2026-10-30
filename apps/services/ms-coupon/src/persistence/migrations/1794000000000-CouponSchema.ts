import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de ms_coupon (Plan/ms_coupon/ms_coupon.sql): cupones y acuerdo B2B de promociones con sus destinos. */
const UP = [
  `CREATE DOMAIN dom_correo AS varchar(160) CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')`,
  `CREATE DOMAIN dom_telefono AS varchar(20) CHECK (VALUE ~ '^\\+?[0-9]{7,15}$')`,
  `CREATE DOMAIN dom_importe AS numeric(12,2) CHECK (VALUE >= 0)`,

  `CREATE FUNCTION fn_actualizar_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
     RETURN NEW;
   END $$`,

  // Los usos de cada cupón se cuentan en orden_cupon (Order), no aquí.
  `CREATE TABLE cupon (
    cup_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cup_codigo varchar(30) NOT NULL CONSTRAINT uq_cupon_codigo UNIQUE,
    cup_tipo varchar(20) NOT NULL,
    cup_valor dom_importe NOT NULL,
    cup_fecha_inicio date NOT NULL,
    cup_fecha_fin date,
    cup_usos_max integer,
    cup_activo boolean NOT NULL DEFAULT TRUE,
    CONSTRAINT cupon_codigo_formato CHECK (cup_codigo ~ '^[A-Z0-9_-]{3,30}$'),
    CONSTRAINT cupon_tipo_valido CHECK (cup_tipo IN ('PORCENTAJE', 'FIJO')),
    CONSTRAINT cupon_vigencia_valida CHECK (cup_fecha_fin IS NULL OR cup_fecha_fin >= cup_fecha_inicio),
    CONSTRAINT cupon_usos_valido CHECK (cup_usos_max IS NULL OR cup_usos_max > 0),
    CONSTRAINT cupon_porcentaje_valido CHECK (cup_tipo <> 'PORCENTAJE' OR cup_valor <= 100)
  )`,
  `CREATE INDEX ix_cupon_activo ON cupon (cup_activo)`,

  // Acuerdo comercial B2B con Booking Prototipo (PromocionesContratoResponse del contrato v3).
  `CREATE TABLE acuerdo_promocion (
    apr_id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    apr_proveedor_codigo varchar(60) NOT NULL CONSTRAINT uq_acuerdo_promocion_proveedor UNIQUE,
    apr_nombre_comercial varchar(150),
    apr_permite_promociones boolean NOT NULL,
    apr_porcentaje_descuento_max numeric(5,2) NOT NULL DEFAULT 0,
    apr_fecha_acuerdo date NOT NULL DEFAULT CURRENT_DATE,
    apr_vigencia_hasta date NOT NULL,
    apr_condiciones_combo varchar(500),
    apr_contacto_nombre varchar(120),
    apr_contacto_correo dom_correo,
    apr_contacto_telefono dom_telefono,
    apr_actualizado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT acuerdo_promocion_porcentaje_valido CHECK (apr_porcentaje_descuento_max BETWEEN 0 AND 50),
    CONSTRAINT acuerdo_promocion_vigencia_valida CHECK (apr_vigencia_hasta >= apr_fecha_acuerdo)
  )`,

  // destinos_habilitados: ciudades donde aplica la promoción (ciu_id es un ID lógico de Location).
  `CREATE TABLE acuerdo_promocion_destino (
    apr_id smallint NOT NULL,
    ciu_id smallint NOT NULL,
    CONSTRAINT pk_acuerdo_promocion_destino PRIMARY KEY (apr_id, ciu_id),
    CONSTRAINT fk_acuerdo_promocion_destino_acuerdo FOREIGN KEY (apr_id) REFERENCES acuerdo_promocion (apr_id)
      ON UPDATE CASCADE ON DELETE CASCADE
  )`,
  `CREATE INDEX ix_acuerdo_promocion_destino_ciu_id ON acuerdo_promocion_destino (ciu_id)`,

  `CREATE TRIGGER trg_acuerdo_promocion_actualizado BEFORE UPDATE ON acuerdo_promocion
     FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('apr_actualizado_en')`,
];

const DOWN = [
  'DROP TABLE acuerdo_promocion_destino',
  'DROP TABLE acuerdo_promocion',
  'DROP TABLE cupon',
  'DROP FUNCTION fn_actualizar_timestamp()',
  'DROP DOMAIN dom_importe',
  'DROP DOMAIN dom_telefono',
  'DROP DOMAIN dom_correo',
];

export class CouponSchema1794000000000 implements MigrationInterface {
  name = 'CouponSchema1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
