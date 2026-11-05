import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outbox transaccional de Identity: los cambios de roles, cuentas y socios llegan al bus y ms-audit los guarda en la
 * bitácora (`Plan/PLAN_BITACORA_IDENTITY.md`). DDL de `Plan/ms_identity/ms_identity.sql` (sección "Outbox").
 */
const UP = String.raw`CREATE TABLE outbox (
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
CREATE INDEX ix_outbox_pendientes ON outbox (creado_en) WHERE publicado_en IS NULL;`;

export class IdentityOutbox1796000000300 implements MigrationInterface {
  name = 'IdentityOutbox1796000000300';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE outbox');
  }
}
