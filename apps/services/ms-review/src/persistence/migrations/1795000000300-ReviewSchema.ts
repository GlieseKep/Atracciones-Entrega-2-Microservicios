import { outboxDdl } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de ms_review (Plan/ms_review/ms_review.sql): reseñas, resumen por atracción y outbox de eventos. */
const UP = [
  `CREATE DOMAIN dom_nota AS numeric(3,1) CHECK (VALUE BETWEEN 1 AND 10)`,

  // atr_codigo, usu_id y res_codigo son IDs lógicos (Catalog, Identity, Booking), sin FK.
  `CREATE TABLE resena (
    ren_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo char(12) NOT NULL,
    usu_id varchar(64),
    res_codigo varchar(40),
    ren_autor_nombre varchar(120),
    ren_puntuacion dom_nota NOT NULL,
    ren_limpieza dom_nota NOT NULL,
    ren_servicio dom_nota NOT NULL,
    ren_calidad_precio dom_nota NOT NULL,
    ren_puntualidad dom_nota NOT NULL,
    ren_comentario varchar(1000),
    ren_visible boolean NOT NULL DEFAULT TRUE,
    ren_motivo_ocultamiento varchar(300),
    ren_moderada_en timestamptz,
    ren_creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resena_atr_codigo_formato CHECK (atr_codigo ~ '^[A-Za-z0-9]{12}$'),
    CONSTRAINT uq_resena_atraccion_usuario UNIQUE (atr_codigo, usu_id),
    CONSTRAINT uq_resena_reserva UNIQUE (res_codigo),
    CONSTRAINT resena_autor_coherente
      CHECK ((usu_id IS NOT NULL AND ren_autor_nombre IS NULL) OR (usu_id IS NULL AND ren_autor_nombre IS NOT NULL)),
    CONSTRAINT resena_usuario_con_reserva CHECK (usu_id IS NULL OR res_codigo IS NOT NULL),
    CONSTRAINT resena_oculta_con_motivo
      CHECK (ren_visible OR (ren_motivo_ocultamiento IS NOT NULL AND ren_moderada_en IS NOT NULL))
  )`,
  `CREATE INDEX ix_resena_atr_visible ON resena (atr_codigo, ren_creado_en DESC) WHERE ren_visible`,
  `CREATE INDEX ix_resena_usu_id ON resena (usu_id)`,

  // Resumen de las reseñas visibles; cal_version sube en cada cambio (Catalog descarta eventos más viejos).
  `CREATE TABLE atraccion_calificacion (
    atr_codigo char(12) PRIMARY KEY,
    cal_total integer NOT NULL DEFAULT 0 CONSTRAINT ck_calificacion_total CHECK (cal_total >= 0),
    cal_puntuacion numeric(3,1) NOT NULL DEFAULT 0,
    cal_limpieza numeric(3,1) NOT NULL DEFAULT 0,
    cal_servicio numeric(3,1) NOT NULL DEFAULT 0,
    cal_calidad_precio numeric(3,1) NOT NULL DEFAULT 0,
    cal_puntualidad numeric(3,1) NOT NULL DEFAULT 0,
    cal_version bigint NOT NULL DEFAULT 0,
    cal_actualizado_en timestamptz NOT NULL DEFAULT now()
  )`,

  // review.ResenaPublicada (Catalog actualiza rating y review_count con este evento).
  ...outboxDdl(),
];

const DOWN = [
  'DROP TABLE outbox',
  'DROP TABLE atraccion_calificacion',
  'DROP TABLE resena',
  'DROP DOMAIN dom_nota',
];

export class ReviewSchema1795000000300 implements MigrationInterface {
  name = 'ReviewSchema1795000000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
