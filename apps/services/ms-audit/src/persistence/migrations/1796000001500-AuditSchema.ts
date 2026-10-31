import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL literal de Plan/ms_audit/ms_audit.sql. */
const UP = String.raw`CREATE TABLE bitacora (
    bit_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bit_event_id       UUID        NOT NULL UNIQUE,     -- id del evento del bus
    usu_id             BIGINT,                      -- ID logico (Identity); NULL si es anonimo
    bit_accion         VARCHAR(60) NOT NULL,
    bit_entidad        VARCHAR(60) NOT NULL,
    bit_entidad_id     VARCHAR(64),
    bit_correlation_id VARCHAR(64),                 -- X-Correlation-Id
    bit_detalle        JSONB,
    bit_ip             VARCHAR(45),
    bit_creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_bitacora_usu_id      ON bitacora (usu_id);
CREATE INDEX ix_bitacora_fecha       ON bitacora (bit_creado_en DESC);
CREATE INDEX ix_bitacora_entidad     ON bitacora (bit_entidad, bit_entidad_id);
CREATE INDEX ix_bitacora_correlation ON bitacora (bit_correlation_id);`;

export class AuditSchema1796000001500 implements MigrationInterface {
  name = 'AuditSchema1796000001500';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE bitacora');
  }
}
