import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL literal de Plan/ms_pricing/ms_pricing.sql. */
const UP = String.raw`CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE DOMAIN dom_moneda AS CHAR(3)
    CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

-- Tarifas versionadas. El precio no se recalcula al vuelo: Order guarda el
-- precio aplicado (QuoteTickets) en orden_detalle.
CREATE TABLE tarifa (
    tar_id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- tariff_id
    atr_codigo        CHAR(12)    NOT NULL,         -- attraction_id: codigo publico (Catalog)
    tar_tipo          VARCHAR(20) NOT NULL,         -- ticket_type
    tar_precio        dom_importe NOT NULL,         -- price
    tar_moneda        dom_moneda  NOT NULL DEFAULT 'USD',
    tar_vigente_desde DATE        NOT NULL DEFAULT CURRENT_DATE,  -- valid_from
    tar_vigente_hasta DATE,                         -- valid_to (NULL = vigente sin fin)
    CONSTRAINT uq_tarifa_atraccion_tipo_desde UNIQUE (atr_codigo, tar_tipo, tar_vigente_desde),
    CONSTRAINT tarifa_atr_codigo_formato CHECK (atr_codigo ~ '^[A-Za-z0-9]{12}$'),
    CONSTRAINT tarifa_tipo_valido
        CHECK (tar_tipo IN ('ADULT', 'CHILD', 'SENIOR', 'INFANT', 'STUDENT')),
    CONSTRAINT tarifa_vigencia_valida
        CHECK (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= tar_vigente_desde),
    -- Sin solapes entre versiones de la misma atraccion y tipo (TARIFF_OVERLAP).
    CONSTRAINT ex_tarifa_sin_solape EXCLUDE USING gist (
        atr_codigo WITH =,
        tar_tipo WITH =,
        daterange(tar_vigente_desde, tar_vigente_hasta, '[]') WITH &&
    )
);
CREATE INDEX ix_tarifa_atr_codigo ON tarifa (atr_codigo);

-- Transactional Outbox: TARIFA_ACTUALIZADA se escribe en la misma transaccion
-- que el cambio de tarifa y el relay del servicio lo publica en el bus.
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

export class PricingSchema1796000000400 implements MigrationInterface {
  name = 'PricingSchema1796000000400';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE outbox');
    await queryRunner.query('DROP TABLE tarifa');
    await queryRunner.query('DROP DOMAIN dom_importe');
    await queryRunner.query('DROP DOMAIN dom_moneda');
  }
}
