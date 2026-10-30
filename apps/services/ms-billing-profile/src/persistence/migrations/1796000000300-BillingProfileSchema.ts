import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL literal de Plan/ms_billing_profile/ms_billing_profile.sql. */
const UP = String.raw`CREATE DOMAIN dom_correo AS VARCHAR(160)
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
CREATE INDEX ix_dato_facturacion_usu_id ON dato_facturacion (usu_id);`;

export class BillingProfileSchema1796000000300 implements MigrationInterface {
  name = 'BillingProfileSchema1796000000300';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE dato_facturacion');
    await queryRunner.query('DROP DOMAIN dom_telefono');
    await queryRunner.query('DROP DOMAIN dom_correo');
  }
}
