import { METODOS_PAGO, outboxDdl, SOLICITANTES_CANCELACION, sqlList } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de payment_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 8). */
const UP = [
  `CREATE TABLE metodo_pago (
    codigo varchar(25) PRIMARY KEY CONSTRAINT ck_metodo_pago_codigo CHECK (codigo IN ${sqlList(METODOS_PAGO)}),
    nombre varchar(80) NOT NULL,
    activo boolean NOT NULL DEFAULT true
  )`,

  `CREATE TABLE pago (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_id uuid NOT NULL,
    metodo_pago varchar(25) NOT NULL CONSTRAINT fk_pago_metodo REFERENCES metodo_pago (codigo),
    estado varchar(12) NOT NULL DEFAULT 'PENDIENTE' CONSTRAINT ck_pago_estado CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'ANULADO')),
    monto numeric(10,2) NOT NULL CONSTRAINT ck_pago_monto CHECK (monto >= 0),
    moneda char(3) NOT NULL DEFAULT 'USD' CONSTRAINT ck_pago_moneda CHECK (moneda ~ '^[A-Z]{3}$'),
    referencia_externa varchar(80),
    referencia_pasarela varchar(80) CONSTRAINT uq_pago_referencia_pasarela UNIQUE,
    motivo_rechazo varchar(300),
    clave_idempotencia varchar(120) NOT NULL CONSTRAINT uq_pago_clave UNIQUE,
    creado_en timestamptz NOT NULL DEFAULT now(),
    procesado_en timestamptz,
    CONSTRAINT ck_pago_rechazo CHECK ((estado = 'RECHAZADO') = (motivo_rechazo IS NOT NULL))
  )`,
  `CREATE INDEX ix_pago_orden ON pago (orden_id)`,

  `CREATE TABLE pago_tarjeta (
    pago_id uuid PRIMARY KEY CONSTRAINT fk_pago_tarjeta_pago REFERENCES pago (id) ON DELETE CASCADE,
    marca varchar(20) NOT NULL,
    ultimos_4 char(4) NOT NULL CONSTRAINT ck_pago_tarjeta_ultimos_4 CHECK (ultimos_4 ~ '^[0-9]{4}$'),
    codigo_autorizacion varchar(20),
    codigo_respuesta varchar(10) NOT NULL,
    mensaje_respuesta varchar(300) NOT NULL
  )`,

  `CREATE TABLE pago_transferencia (
    pago_id uuid PRIMARY KEY CONSTRAINT fk_pago_transferencia_pago REFERENCES pago (id) ON DELETE CASCADE,
    banco varchar(100),
    numero_comprobante varchar(60),
    fecha_transferencia date,
    verificado_por uuid,
    verificado_en timestamptz,
    CONSTRAINT ck_pago_transferencia_verificacion CHECK ((verificado_por IS NULL) = (verificado_en IS NULL))
  )`,

  `CREATE TABLE reembolso (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo varchar(30) NOT NULL CONSTRAINT uq_reembolso_codigo UNIQUE,
    pago_id uuid NOT NULL CONSTRAINT fk_reembolso_pago REFERENCES pago (id),
    monto numeric(10,2) NOT NULL CONSTRAINT ck_reembolso_monto CHECK (monto > 0),
    motivo varchar(500) NOT NULL,
    solicitante varchar(20) NOT NULL CONSTRAINT ck_reembolso_solicitante CHECK (solicitante IN ${sqlList(SOLICITANTES_CANCELACION)}),
    estado varchar(10) NOT NULL DEFAULT 'PENDIENTE' CONSTRAINT ck_reembolso_estado CHECK (estado IN ('PENDIENTE', 'EMITIDO', 'FALLIDO')),
    clave_idempotencia varchar(120) NOT NULL CONSTRAINT uq_reembolso_clave UNIQUE,
    creado_en timestamptz NOT NULL DEFAULT now(),
    emitido_en timestamptz,
    CONSTRAINT ck_reembolso_emitido CHECK ((estado = 'EMITIDO') = (emitido_en IS NOT NULL))
  )`,
  `CREATE INDEX ix_reembolso_pago ON reembolso (pago_id)`,

  `CREATE TABLE webhook_recibido (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pasarela varchar(20) NOT NULL CONSTRAINT ck_webhook_recibido_pasarela CHECK (pasarela IN ('PAYPHONE', 'PAYPAL', 'KUSHKI')),
    evento_externo_id varchar(100) NOT NULL,
    payload jsonb NOT NULL,
    estado varchar(12) NOT NULL DEFAULT 'RECIBIDO' CONSTRAINT ck_webhook_recibido_estado CHECK (estado IN ('RECIBIDO', 'PROCESADO', 'ERROR')),
    correlation_id varchar(100) NOT NULL,
    recibido_en timestamptz NOT NULL DEFAULT now(),
    procesado_en timestamptz,
    CONSTRAINT uq_webhook_recibido_evento UNIQUE (pasarela, evento_externo_id)
  )`,
  `CREATE INDEX ix_webhook_recibido_pendientes ON webhook_recibido (recibido_en) WHERE estado = 'RECIBIDO'`,

  ...outboxDdl(),

  // Saldo de cada pago después de los reembolsos emitidos (reemplaza los estados REEMBOLSADO / REEMBOLSADO_PARCIAL).
  `CREATE VIEW v_pago_saldo AS
     SELECT p.id AS pago_id,
            p.monto,
            coalesce(r.reembolsado, 0)::numeric(10,2) AS reembolsado,
            (p.monto - coalesce(r.reembolsado, 0))::numeric(10,2) AS saldo
       FROM pago p
       LEFT JOIN (SELECT pago_id, sum(monto) AS reembolsado FROM reembolso WHERE estado = 'EMITIDO' GROUP BY pago_id) r
              ON r.pago_id = p.id`,
];

const DOWN = [
  'DROP VIEW v_pago_saldo',
  'DROP TABLE outbox',
  'DROP TABLE webhook_recibido',
  'DROP TABLE reembolso',
  'DROP TABLE pago_transferencia',
  'DROP TABLE pago_tarjeta',
  'DROP TABLE pago',
  'DROP TABLE metodo_pago',
];

export class PaymentSchema1793000000000 implements MigrationInterface {
  name = 'PaymentSchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
