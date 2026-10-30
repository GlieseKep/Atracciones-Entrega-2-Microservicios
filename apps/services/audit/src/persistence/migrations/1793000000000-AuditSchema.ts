import { sqlList, TIPOS_EVENTO_PUBLICO } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de audit_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 10). */
const UP = [
  `CREATE TABLE tipo_evento (
    nombre varchar(60) PRIMARY KEY,
    servicio_origen varchar(30) NOT NULL CONSTRAINT ck_tipo_evento_servicio CHECK (servicio_origen IN
      ('identity', 'catalog', 'inventory', 'cart', 'order', 'booking', 'payment', 'invoicing', 'audit')),
    tipo_agregado varchar(40) NOT NULL
  )`,
  // Un evento interno puede publicarse como varios eventos del feed (ReservaEmitida → RESERVA_CREADA y RESERVA_CONFIRMADA).
  `CREATE TABLE tipo_evento_publico (
    tipo_evento varchar(60) NOT NULL CONSTRAINT fk_tipo_evento_publico_tipo REFERENCES tipo_evento (nombre) ON DELETE CASCADE,
    tipo_publico varchar(20) NOT NULL CONSTRAINT ck_tipo_evento_publico_tipo CHECK (tipo_publico IN ${sqlList(TIPOS_EVENTO_PUBLICO)}),
    orden smallint NOT NULL CONSTRAINT ck_tipo_evento_publico_orden CHECK (orden >= 1),
    CONSTRAINT pk_tipo_evento_publico PRIMARY KEY (tipo_evento, tipo_publico),
    CONSTRAINT uq_tipo_evento_publico_orden UNIQUE (tipo_evento, orden)
  )`,

  `CREATE TABLE bitacora (
    id bigserial PRIMARY KEY,
    event_id uuid NOT NULL CONSTRAINT uq_bitacora_event_id UNIQUE,
    tipo_evento varchar(60) NOT NULL CONSTRAINT fk_bitacora_tipo_evento REFERENCES tipo_evento (nombre),
    agregado_id varchar(60) NOT NULL,
    actor varchar(300),
    correlation_id varchar(100) NOT NULL,
    node_id varchar(80),
    payload jsonb NOT NULL,
    ocurrido_en timestamptz NOT NULL,
    registrado_en timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX ix_bitacora_correlation ON bitacora (correlation_id)`,
  `CREATE INDEX ix_bitacora_agregado ON bitacora (tipo_evento, agregado_id)`,
  `CREATE INDEX ix_bitacora_ocurrido_en ON bitacora (ocurrido_en)`,

  `CREATE TABLE evento_integracion (
    sequence_number bigserial PRIMARY KEY,
    event_id uuid NOT NULL CONSTRAINT uq_evento_integracion_event_id UNIQUE,
    event_type varchar(20) NOT NULL CONSTRAINT ck_evento_integracion_tipo CHECK (event_type IN ${sqlList(TIPOS_EVENTO_PUBLICO)}),
    aggregate_id varchar(60) NOT NULL,
    correlation_id varchar(100) NOT NULL,
    ocurrido_en timestamptz NOT NULL,
    payload jsonb NOT NULL
  )`,
  // GET /atracciones/eventos?type=…&after=…
  `CREATE INDEX ix_evento_integracion_tipo ON evento_integracion (event_type, sequence_number)`,

  `CREATE TABLE mensaje_contacto (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid,
    nombre varchar(200) NOT NULL,
    email varchar(254) NOT NULL,
    asunto varchar(200) NOT NULL,
    mensaje varchar(4000) NOT NULL,
    estado varchar(12) NOT NULL DEFAULT 'NUEVO' CONSTRAINT ck_mensaje_contacto_estado CHECK (estado IN ('NUEVO', 'EN_PROCESO', 'RESPONDIDO', 'CERRADO')),
    correlation_id varchar(100) NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    respondido_en timestamptz,
    CONSTRAINT ck_mensaje_contacto_respondido CHECK (respondido_en IS NULL OR estado IN ('RESPONDIDO', 'CERRADO'))
  )`,
  `CREATE INDEX ix_mensaje_contacto_estado ON mensaje_contacto (estado, creado_en)`,
];

const DOWN = [
  'DROP TABLE mensaje_contacto',
  'DROP TABLE evento_integracion',
  'DROP TABLE bitacora',
  'DROP TABLE tipo_evento_publico',
  'DROP TABLE tipo_evento',
];

export class AuditSchema1793000000000 implements MigrationInterface {
  name = 'AuditSchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
