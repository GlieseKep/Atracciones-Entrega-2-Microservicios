import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL literal de Plan/ms_inventory/ms_inventory.sql. */
const UP = String.raw`CREATE TABLE horario (
    hor_id     BIGINT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo CHAR(12) NOT NULL,                  -- ID logico (Catalog): id del contrato
    hor_hora   TIME    NOT NULL,
    hor_cupo   INTEGER NOT NULL DEFAULT 20,
    hor_activo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT horario_cupo_positivo CHECK (hor_cupo > 0),
    CONSTRAINT uq_horario_atraccion_hora UNIQUE (atr_codigo, hor_hora),
    -- Clave candidata para la FK compuesta desde disponibilidad
    CONSTRAINT uq_horario_id_atraccion UNIQUE (hor_id, atr_codigo)
);
CREATE INDEX ix_horario_atr_codigo ON horario (atr_codigo);

CREATE TABLE disponibilidad (
    dis_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo         CHAR(12)    NOT NULL,        -- ID logico (Catalog): id del contrato
    hor_id             BIGINT      NOT NULL,
    dis_fecha          DATE        NOT NULL,
    dis_slot_codigo    VARCHAR(40) NOT NULL,        -- slot_id, ej. slot-20261025-1030
    dis_cupo_total     INTEGER     NOT NULL,
    dis_cupo_reservado INTEGER     NOT NULL DEFAULT 0,
    dis_cerrada        BOOLEAN     NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_disponibilidad_atraccion_fecha_horario UNIQUE (atr_codigo, dis_fecha, hor_id),
    CONSTRAINT uq_disponibilidad_atraccion_slot UNIQUE (atr_codigo, dis_slot_codigo),
    -- La fecha del slot_id debe coincidir con dis_fecha (SLOT_TIME_MISMATCH);
    -- la hora la valida el servicio contra horario.hor_hora.
    CONSTRAINT disponibilidad_slot_formato
        CHECK (dis_slot_codigo = 'slot-' || to_char(dis_fecha, 'YYYYMMDD') || '-' || right(dis_slot_codigo, 4)
               AND dis_slot_codigo ~ '^slot-[0-9]{8}-[0-9]{4}$'),
    CONSTRAINT disponibilidad_cupos_validos
        CHECK (dis_cupo_total > 0
               AND dis_cupo_reservado >= 0
               AND dis_cupo_reservado <= dis_cupo_total),
    -- FK compuesta interna: el horario debe ser de la MISMA atraccion
    CONSTRAINT fk_disponibilidad_horario
        FOREIGN KEY (hor_id, atr_codigo) REFERENCES horario (hor_id, atr_codigo)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_disponibilidad_atr_codigo ON disponibilidad (atr_codigo);
CREATE INDEX ix_disponibilidad_hor_id ON disponibilidad (hor_id, atr_codigo);
CREATE INDEX ix_disponibilidad_fecha  ON disponibilidad (dis_fecha);

CREATE TABLE fecha_bloqueada (
    fb_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo   CHAR(12)     NOT NULL,             -- ID logico (Catalog): id del contrato
    fb_fecha     DATE         NOT NULL,
    fb_motivo    VARCHAR(200) NOT NULL,
    fb_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_fecha_bloqueada_atraccion_fecha UNIQUE (atr_codigo, fb_fecha)
);
CREATE INDEX ix_fecha_bloqueada_atr_codigo ON fecha_bloqueada (atr_codigo);

-- Cupos descontados por una reserva. La clave hace idempotentes el descuento y su reintegro.
CREATE TABLE bloqueo_cupo (
    blo_id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dis_id          BIGINT       NOT NULL,
    blo_clave       VARCHAR(120) NOT NULL UNIQUE,
    blo_cantidad    INTEGER      NOT NULL,
    blo_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    blo_liberado_en TIMESTAMPTZ,
    CONSTRAINT bloqueo_cupo_cantidad_valida CHECK (blo_cantidad > 0),
    CONSTRAINT fk_bloqueo_cupo_disponibilidad
        FOREIGN KEY (dis_id) REFERENCES disponibilidad (dis_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_bloqueo_cupo_dis_id ON bloqueo_cupo (dis_id);

-- Transactional Outbox: CupoBloqueado, CupoLiberado y envio de stock a Booking Prototipo.
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

export class InventorySchema1796000000500 implements MigrationInterface {
  name = 'InventorySchema1796000000500';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['outbox', 'bloqueo_cupo', 'fecha_bloqueada', 'disponibilidad', 'horario']) await queryRunner.query(`DROP TABLE ${table}`);
  }
}
