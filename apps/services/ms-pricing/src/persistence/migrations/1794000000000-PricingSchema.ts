import { outboxDdl, sqlList, TIPOS_BOLETO } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de ms_pricing (Plan/ms_pricing/ms_pricing.sql): tarifas versionadas y outbox de TARIFA_ACTUALIZADA. */
const UP = [
  `CREATE EXTENSION IF NOT EXISTS btree_gist`,
  `CREATE DOMAIN dom_moneda AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$')`,
  `CREATE DOMAIN dom_importe AS numeric(12,2) CHECK (VALUE >= 0)`,

  // El precio no se recalcula al vuelo: Order guarda el precio cotizado (QuoteTickets) en orden_detalle.
  `CREATE TABLE tarifa (
    tar_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_codigo char(12) NOT NULL,
    tar_tipo varchar(20) NOT NULL,
    tar_precio dom_importe NOT NULL,
    tar_moneda dom_moneda NOT NULL DEFAULT 'USD',
    tar_vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
    tar_vigente_hasta date,
    CONSTRAINT uq_tarifa_atraccion_tipo_desde UNIQUE (atr_codigo, tar_tipo, tar_vigente_desde),
    CONSTRAINT tarifa_atr_codigo_formato CHECK (atr_codigo ~ '^[A-Za-z0-9]{12}$'),
    CONSTRAINT tarifa_tipo_valido CHECK (tar_tipo IN ${sqlList(TIPOS_BOLETO)}),
    CONSTRAINT tarifa_vigencia_valida CHECK (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= tar_vigente_desde),
    -- Sin solapes entre versiones de la misma atracción y tipo: una sola tarifa vigente por fecha (TARIFF_OVERLAP).
    CONSTRAINT ex_tarifa_sin_solape EXCLUDE USING gist (
      atr_codigo WITH =,
      tar_tipo WITH =,
      daterange(tar_vigente_desde, tar_vigente_hasta, '[]') WITH &&
    )
  )`,
  `CREATE INDEX ix_tarifa_atr_codigo ON tarifa (atr_codigo)`,

  ...outboxDdl(),
];

const DOWN = ['DROP TABLE outbox', 'DROP TABLE tarifa', 'DROP DOMAIN dom_importe', 'DROP DOMAIN dom_moneda'];

export class PricingSchema1794000000000 implements MigrationInterface {
  name = 'PricingSchema1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
