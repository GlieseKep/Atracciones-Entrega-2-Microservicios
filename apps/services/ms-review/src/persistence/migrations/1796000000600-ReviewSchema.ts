import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL literal de Plan/ms_review/ms_review.sql. */
const UP = String.raw`CREATE TABLE resena (
    ren_id             BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id             BIGINT        NOT NULL,      -- ID logico (Catalog)
    usu_id             BIGINT,                      -- ID logico (Identity); NULL = anonima
    ren_autor_nombre   VARCHAR(120),                -- solo para resenas anonimas
    ren_puntuacion     SMALLINT      NOT NULL,      -- score general
    ren_limpieza       SMALLINT      NOT NULL,      -- breakdown.limpieza
    ren_servicio       SMALLINT      NOT NULL,      -- breakdown.servicio
    ren_calidad_precio SMALLINT      NOT NULL,      -- breakdown.calidad_precio
    ren_puntualidad    SMALLINT      NOT NULL,      -- breakdown.puntualidad
    ren_comentario     VARCHAR(1000) NOT NULL,
    ren_visible        BOOLEAN       NOT NULL DEFAULT TRUE,
    ren_creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT resena_puntuaciones_validas CHECK (
        ren_puntuacion     BETWEEN 1 AND 10 AND
        ren_limpieza       BETWEEN 1 AND 10 AND
        ren_servicio       BETWEEN 1 AND 10 AND
        ren_calidad_precio BETWEEN 1 AND 10 AND
        ren_puntualidad    BETWEEN 1 AND 10),
    CONSTRAINT uq_resena_atraccion_usuario UNIQUE (atr_id, usu_id),
    CONSTRAINT resena_autor_coherente
        CHECK ((usu_id IS NOT NULL AND ren_autor_nombre IS NULL)
            OR (usu_id IS NULL AND ren_autor_nombre IS NOT NULL))
);
CREATE INDEX ix_resena_atr_id ON resena (atr_id);
CREATE INDEX ix_resena_usu_id ON resena (usu_id);

-- Transactional Outbox: RESENA_PUBLICADA.
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
CREATE INDEX ix_outbox_pendientes ON outbox (creado_en) WHERE publicado_en IS NULL;`;

export class ReviewSchema1796000000600 implements MigrationInterface {
  name = 'ReviewSchema1796000000600';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE outbox');
    await queryRunner.query('DROP TABLE resena');
  }
}
