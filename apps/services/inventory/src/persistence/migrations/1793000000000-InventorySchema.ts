import { outboxDdl, sqlArray, sqlList, TIPOS_BOLETO, TIPOS_BOLETO_OBLIGATORIOS_EN_TARIFA } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema exigido por el contrato (`schema_atracciones.turnos_aforo`). Todas las tablas de Inventory viven en él. */
const S = 'schema_atracciones';

/** Esquema de inventory_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 4). */
const UP = [
  `CREATE EXTENSION IF NOT EXISTS btree_gist`,
  `CREATE SCHEMA ${S}`,

  `CREATE TABLE ${S}.guia (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo varchar(40) NOT NULL CONSTRAINT uq_guia_codigo UNIQUE,
    titulo varchar(20),
    nombre varchar(200) NOT NULL,
    credencial_mintur varchar(30),
    usuario_id uuid,
    activo boolean NOT NULL DEFAULT true
  )`,

  `CREATE TABLE ${S}.horario (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    atraccion_codigo char(12) NOT NULL,
    dia_semana smallint NOT NULL CONSTRAINT ck_horario_dia_semana CHECK (dia_semana BETWEEN 1 AND 7),
    hora_inicio time NOT NULL,
    capacidad int NOT NULL CONSTRAINT ck_horario_capacidad CHECK (capacidad > 0),
    guia_id uuid CONSTRAINT fk_horario_guia REFERENCES ${S}.guia (id),
    vigente_desde date NOT NULL,
    vigente_hasta date,
    activo boolean NOT NULL DEFAULT true,
    CONSTRAINT uq_horario UNIQUE (atraccion_codigo, dia_semana, hora_inicio, vigente_desde),
    CONSTRAINT ck_horario_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
  )`,

  `CREATE TABLE ${S}.turnos_aforo (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    atraccion_codigo char(12) NOT NULL,
    fecha date NOT NULL,
    hora time NOT NULL,
    cupos_totales int NOT NULL CONSTRAINT ck_turnos_aforo_totales CHECK (cupos_totales >= 0),
    cupos_reservados int NOT NULL DEFAULT 0,
    guia_id uuid CONSTRAINT fk_turnos_aforo_guia REFERENCES ${S}.guia (id),
    cerrado boolean NOT NULL DEFAULT false,
    version int NOT NULL DEFAULT 0,
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_turnos_aforo_turno UNIQUE (atraccion_codigo, fecha, hora),
    -- Sin sobreventa: ningún UPDATE puede dejar más cupos reservados que totales.
    CONSTRAINT ck_turnos_aforo_cupos CHECK (cupos_reservados >= 0 AND cupos_reservados <= cupos_totales)
  )`,

  `CREATE TABLE ${S}.turno_precio (
    turno_id uuid NOT NULL CONSTRAINT fk_turno_precio_turno REFERENCES ${S}.turnos_aforo (id) ON DELETE CASCADE,
    tipo_boleto varchar(10) NOT NULL CONSTRAINT ck_turno_precio_tipo CHECK (tipo_boleto IN ${sqlList(TIPOS_BOLETO)}),
    precio numeric(10,2) NOT NULL CONSTRAINT ck_turno_precio_precio CHECK (precio >= 0),
    CONSTRAINT pk_turno_precio PRIMARY KEY (turno_id, tipo_boleto)
  )`,

  `CREATE TABLE ${S}.tarifa (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    atraccion_codigo char(12) NOT NULL,
    moneda char(3) NOT NULL DEFAULT 'USD' CONSTRAINT ck_tarifa_moneda CHECK (moneda ~ '^[A-Z]{3}$'),
    vigente_desde date NOT NULL,
    vigente_hasta date,
    CONSTRAINT ck_tarifa_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
    -- Una sola tarifa vigente por atracción y día.
    CONSTRAINT ex_tarifa_superpuesta EXCLUDE USING gist (
      atraccion_codigo WITH =,
      daterange(vigente_desde, vigente_hasta, '[]') WITH &&)
  )`,
  `CREATE TABLE ${S}.tarifa_precio (
    tarifa_id uuid NOT NULL CONSTRAINT fk_tarifa_precio_tarifa REFERENCES ${S}.tarifa (id) ON DELETE CASCADE,
    tipo_boleto varchar(10) NOT NULL CONSTRAINT ck_tarifa_precio_tipo CHECK (tipo_boleto IN ${sqlList(TIPOS_BOLETO)}),
    precio numeric(10,2) NOT NULL CONSTRAINT ck_tarifa_precio_precio CHECK (precio >= 0),
    CONSTRAINT pk_tarifa_precio PRIMARY KEY (tarifa_id, tipo_boleto),
    CONSTRAINT ck_tarifa_precio_adulto CHECK (tipo_boleto <> 'ADULT' OR precio > 0)
  )`,
  // Toda tarifa debe tener los precios que el contrato exige; se comprueba al confirmar la transacción.
  `CREATE FUNCTION ${S}.fn_validar_tarifa_completa(p_tarifa uuid) RETURNS void LANGUAGE plpgsql AS $$
   DECLARE faltantes text;
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM ${S}.tarifa WHERE id = p_tarifa) THEN RETURN; END IF;
     SELECT string_agg(t.tipo, ', ') INTO faltantes
       FROM unnest(${sqlArray(TIPOS_BOLETO_OBLIGATORIOS_EN_TARIFA)}) AS t(tipo)
      WHERE NOT EXISTS (SELECT 1 FROM ${S}.tarifa_precio p WHERE p.tarifa_id = p_tarifa AND p.tipo_boleto = t.tipo);
     IF faltantes IS NOT NULL THEN
       RAISE EXCEPTION 'La tarifa % no tiene precio para: %', p_tarifa, faltantes USING ERRCODE = '23514';
     END IF;
   END $$`,
  `CREATE FUNCTION ${S}.tg_tarifa_completa() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF TG_TABLE_NAME = 'tarifa' THEN
       PERFORM ${S}.fn_validar_tarifa_completa(NEW.id);
     ELSE
       PERFORM ${S}.fn_validar_tarifa_completa(OLD.tarifa_id);
     END IF;
     RETURN NULL;
   END $$`,
  `CREATE CONSTRAINT TRIGGER tg_tarifa_completa AFTER INSERT ON ${S}.tarifa
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${S}.tg_tarifa_completa()`,
  `CREATE CONSTRAINT TRIGGER tg_tarifa_precio_completa AFTER UPDATE OR DELETE ON ${S}.tarifa_precio
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${S}.tg_tarifa_completa()`,

  `CREATE TABLE ${S}.fecha_bloqueada (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    atraccion_codigo char(12) NOT NULL,
    fecha date NOT NULL,
    motivo varchar(300) NOT NULL,
    CONSTRAINT uq_fecha_bloqueada UNIQUE (atraccion_codigo, fecha)
  )`,

  `CREATE TABLE ${S}.reserva_cupo (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turno_id uuid NOT NULL CONSTRAINT fk_reserva_cupo_turno REFERENCES ${S}.turnos_aforo (id),
    orden_id uuid NOT NULL,
    cantidad int NOT NULL CONSTRAINT ck_reserva_cupo_cantidad CHECK (cantidad > 0),
    clave_idempotencia varchar(120) NOT NULL CONSTRAINT uq_reserva_cupo_clave UNIQUE,
    creado_en timestamptz NOT NULL DEFAULT now(),
    liberado_en timestamptz,
    CONSTRAINT ck_reserva_cupo_liberado CHECK (liberado_en IS NULL OR liberado_en >= creado_en)
  )`,
  `CREATE INDEX ix_reserva_cupo_turno ON ${S}.reserva_cupo (turno_id)`,
  `CREATE INDEX ix_reserva_cupo_orden ON ${S}.reserva_cupo (orden_id)`,

  `CREATE TABLE ${S}.sincronizacion_booking (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL CONSTRAINT uq_sincronizacion_booking_event UNIQUE,
    turno_id uuid NOT NULL CONSTRAINT fk_sincronizacion_booking_turno REFERENCES ${S}.turnos_aforo (id),
    metodo varchar(10) NOT NULL CONSTRAINT ck_sincronizacion_booking_metodo CHECK (metodo IN ('PUSH', 'STREAM')),
    cupos_disponibles int CONSTRAINT ck_sincronizacion_booking_cupos CHECK (cupos_disponibles >= 0),
    delta int,
    generado_en timestamptz NOT NULL DEFAULT now(),
    estado varchar(10) NOT NULL DEFAULT 'PENDIENTE' CONSTRAINT ck_sincronizacion_booking_estado CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'ERROR')),
    intentos int NOT NULL DEFAULT 0 CONSTRAINT ck_sincronizacion_booking_intentos CHECK (intentos >= 0),
    respuesta varchar(500),
    procesado_en timestamptz,
    correlation_id varchar(100) NOT NULL,
    -- PushStockUpdate envía available_units; StreamInventoryChanges envía delta.
    CONSTRAINT ck_sincronizacion_booking_valor CHECK (
      (metodo = 'PUSH' AND cupos_disponibles IS NOT NULL AND delta IS NULL)
      OR (metodo = 'STREAM' AND delta IS NOT NULL AND cupos_disponibles IS NULL))
  )`,
  `CREATE INDEX ix_sincronizacion_booking_pendientes ON ${S}.sincronizacion_booking (estado, generado_en) WHERE estado <> 'ENVIADO'`,

  ...outboxDdl(S),
];

const DOWN = [
  `DROP TABLE ${S}.outbox`,
  `DROP TABLE ${S}.sincronizacion_booking`,
  `DROP TABLE ${S}.reserva_cupo`,
  `DROP TABLE ${S}.fecha_bloqueada`,
  `DROP TABLE ${S}.tarifa_precio`,
  `DROP TABLE ${S}.tarifa`,
  `DROP FUNCTION ${S}.tg_tarifa_completa()`,
  `DROP FUNCTION ${S}.fn_validar_tarifa_completa(uuid)`,
  `DROP TABLE ${S}.turno_precio`,
  `DROP TABLE ${S}.turnos_aforo`,
  `DROP TABLE ${S}.horario`,
  `DROP TABLE ${S}.guia`,
  `DROP SCHEMA ${S}`,
];

export class InventorySchema1793000000000 implements MigrationInterface {
  name = 'InventorySchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
