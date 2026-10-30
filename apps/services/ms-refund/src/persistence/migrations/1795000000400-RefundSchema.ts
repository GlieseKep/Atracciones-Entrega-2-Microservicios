import { outboxDdl, SOLICITANTES_CANCELACION, sqlList } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de ms_refund (Plan/ms_refund/ms_refund.sql): reembolsos, lo comprometido por pago y outbox de eventos. */
const UP = [
  `CREATE DOMAIN dom_importe AS numeric(12,2) CHECK (VALUE >= 0)`,

  // pag_id (Payment) y ord_id (Order) son IDs lógicos, sin FK. rem_numero = reembolso_id del contrato v3.
  `CREATE TABLE reembolso (
    rem_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id uuid NOT NULL,
    ord_id uuid NOT NULL,
    rem_numero varchar(30) NOT NULL CONSTRAINT uq_reembolso_numero UNIQUE,
    rem_monto dom_importe NOT NULL,
    rem_moneda char(3) NOT NULL DEFAULT 'USD',
    rem_motivo varchar(300) NOT NULL,
    rem_solicitante varchar(20) NOT NULL,
    rem_estado varchar(10) NOT NULL DEFAULT 'PENDIENTE',
    rem_referencia varchar(100),
    rem_clave_idempotencia varchar(120) NOT NULL CONSTRAINT uq_reembolso_clave UNIQUE,
    rem_solicitado_en timestamptz NOT NULL DEFAULT now(),
    rem_procesado_en timestamptz,
    rem_creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reembolso_monto_valido CHECK (rem_monto > 0),
    CONSTRAINT reembolso_numero_formato CHECK (rem_numero ~ '^REF-ATR-[A-Z0-9]{6,12}$'),
    CONSTRAINT reembolso_moneda_valida CHECK (rem_moneda ~ '^[A-Z]{3}$'),
    CONSTRAINT reembolso_estado_valido CHECK (rem_estado IN ('PENDIENTE', 'EMITIDO', 'FALLIDO')),
    CONSTRAINT reembolso_solicitante_valido CHECK (rem_solicitante IN ${sqlList(SOLICITANTES_CANCELACION)}),
    CONSTRAINT reembolso_procesado_coherente CHECK ((rem_estado = 'PENDIENTE') = (rem_procesado_en IS NULL))
  )`,
  `CREATE INDEX ix_reembolso_pag_id ON reembolso (pag_id)`,
  `CREATE INDEX ix_reembolso_ord_id ON reembolso (ord_id)`,

  // Lo ya reembolsado por pago: los FALLIDO no cuentan; los PENDIENTE sí, para no superar el saldo en paralelo.
  `CREATE VIEW v_pago_reembolsado AS
     SELECT pag_id,
            coalesce(sum(rem_monto) FILTER (WHERE rem_estado = 'EMITIDO'), 0)::numeric(12,2) AS emitido,
            coalesce(sum(rem_monto) FILTER (WHERE rem_estado IN ('EMITIDO', 'PENDIENTE')), 0)::numeric(12,2) AS comprometido
       FROM reembolso
      GROUP BY pag_id`,

  // refund.ReembolsoEmitido (Invoicing emite la nota de crédito).
  ...outboxDdl(),
];

const DOWN = [
  'DROP TABLE outbox',
  'DROP VIEW v_pago_reembolsado',
  'DROP TABLE reembolso',
  'DROP DOMAIN dom_importe',
];

export class RefundSchema1795000000400 implements MigrationInterface {
  name = 'RefundSchema1795000000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
