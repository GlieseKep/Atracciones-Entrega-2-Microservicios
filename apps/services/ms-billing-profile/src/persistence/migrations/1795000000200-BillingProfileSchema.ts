import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de ms_billing_profile (Plan/ms_billing_profile/ms_billing_profile.sql): perfiles de facturación por usuario. */
const UP = [
  `CREATE DOMAIN dom_correo AS varchar(160) CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')`,
  `CREATE DOMAIN dom_telefono AS varchar(20) CHECK (VALUE ~ '^\\+?[0-9]{7,15}$')`,

  `CREATE FUNCTION fn_actualizar_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     NEW.dfa_actualizado_en := now();
     RETURN NEW;
   END $$`,

  // usu_id es el id del principal de Identity (ID lógico, sin FK).
  `CREATE TABLE dato_facturacion (
    dfa_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id varchar(64) NOT NULL,
    dfa_tipo_identificacion varchar(20) NOT NULL DEFAULT 'CEDULA',
    dfa_identificacion varchar(20) NOT NULL,
    dfa_razon_social varchar(150) NOT NULL,
    dfa_correo dom_correo NOT NULL,
    dfa_telefono dom_telefono,
    dfa_direccion varchar(300),
    dfa_es_principal boolean NOT NULL DEFAULT FALSE,
    dfa_activo boolean NOT NULL DEFAULT TRUE,
    dfa_creado_en timestamptz NOT NULL DEFAULT now(),
    dfa_actualizado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dato_facturacion_tipo_valido
      CHECK (dfa_tipo_identificacion IN ('CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL')),
    CONSTRAINT dato_facturacion_identificacion_valida CHECK (
      (dfa_tipo_identificacion = 'CEDULA' AND dfa_identificacion ~ '^[0-9]{10}$') OR
      (dfa_tipo_identificacion = 'RUC' AND dfa_identificacion ~ '^[0-9]{13}$') OR
      (dfa_tipo_identificacion = 'PASAPORTE' AND dfa_identificacion ~ '^[A-Z0-9]{6,20}$') OR
      (dfa_tipo_identificacion = 'CONSUMIDOR_FINAL' AND dfa_identificacion = '9999999999999')),
    CONSTRAINT dato_facturacion_razon_social_no_vacia CHECK (length(btrim(dfa_razon_social)) >= 2),
    CONSTRAINT dato_facturacion_principal_activo CHECK (NOT dfa_es_principal OR dfa_activo),
    CONSTRAINT uq_dato_facturacion_usuario_identificacion UNIQUE (usu_id, dfa_tipo_identificacion, dfa_identificacion)
  )`,
  // Un solo principal por usuario.
  `CREATE UNIQUE INDEX ux_dato_facturacion_principal ON dato_facturacion (usu_id) WHERE dfa_es_principal`,
  `CREATE INDEX ix_dato_facturacion_usu_id ON dato_facturacion (usu_id) WHERE dfa_activo`,

  `CREATE TRIGGER trg_dato_facturacion_actualizado BEFORE UPDATE ON dato_facturacion
     FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp()`,
];

const DOWN = [
  'DROP TABLE dato_facturacion',
  'DROP FUNCTION fn_actualizar_timestamp()',
  'DROP DOMAIN dom_telefono',
  'DROP DOMAIN dom_correo',
];

export class BillingProfileSchema1795000000200 implements MigrationInterface {
  name = 'BillingProfileSchema1795000000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
