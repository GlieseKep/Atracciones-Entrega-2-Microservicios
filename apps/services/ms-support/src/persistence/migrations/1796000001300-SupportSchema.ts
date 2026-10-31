import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL literal de Plan/ms_support/ms_support.sql. */
const UP = String.raw`CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE TABLE mensaje_contacto (
    men_id        BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    men_nombre    VARCHAR(120)  NOT NULL,
    men_correo    dom_correo    NOT NULL,
    men_asunto    VARCHAR(30)   NOT NULL,
    men_cuerpo    VARCHAR(2000) NOT NULL,
    men_leido     BOOLEAN       NOT NULL DEFAULT FALSE,
    men_creado_en TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_mensaje_contacto_leido ON mensaje_contacto (men_leido);`;

export class SupportSchema1796000001300 implements MigrationInterface {
  name = 'SupportSchema1796000001300';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE mensaje_contacto');
    await queryRunner.query('DROP DOMAIN dom_correo');
  }
}
