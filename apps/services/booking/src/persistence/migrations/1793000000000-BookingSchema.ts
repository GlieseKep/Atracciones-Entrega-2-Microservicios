import {
  ESTADOS_RESERVA,
  idempotenciaDdl,
  outboxDdl,
  SOLICITANTES_CANCELACION,
  sqlList,
  TIPOS_BOLETO,
  TIPOS_DOCUMENTO,
  TIPOS_PRINCIPAL,
} from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de booking_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 7). */
// Booking solo se relaciona con sus propias tablas. Los datos de otros servicios se guardan como referencias lógicas
// sin FK: atraccion_codigo (Catalog), codigo_externo_orden (Order), guia_codigo (Inventory), reembolso_codigo (Payment).
const UP = [
  `CREATE TABLE reserva (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_pnr varchar(12) NOT NULL CONSTRAINT uq_reserva_codigo_pnr UNIQUE,
    codigo_externo_orden varchar(30) NOT NULL CONSTRAINT uq_reserva_codigo_externo_orden UNIQUE,
    principal_tipo varchar(12) NOT NULL CONSTRAINT ck_reserva_principal_tipo CHECK (principal_tipo IN ${sqlList(TIPOS_PRINCIPAL)}),
    principal_id uuid NOT NULL,
    atraccion_codigo char(12) NOT NULL,
    fecha date NOT NULL,
    hora time NOT NULL,
    estado varchar(12) NOT NULL CONSTRAINT ck_reserva_estado CHECK (estado IN ${sqlList(ESTADOS_RESERVA)}),
    total numeric(10,2) NOT NULL CONSTRAINT ck_reserva_total CHECK (total >= 0),
    moneda char(3) NOT NULL DEFAULT 'USD' CONSTRAINT ck_reserva_moneda CHECK (moneda ~ '^[A-Z]{3}$'),
    titular_nombre varchar(200) NOT NULL,
    titular_email varchar(254) NOT NULL,
    titular_telefono varchar(20) NOT NULL,
    titular_tipo_documento varchar(10) NOT NULL CONSTRAINT ck_reserva_titular_tipo_documento CHECK (titular_tipo_documento IN ${sqlList(TIPOS_DOCUMENTO)}),
    titular_numero_documento varchar(13) NOT NULL,
    guia_codigo varchar(40) NOT NULL,
    punto_encuentro varchar(300) NOT NULL,
    cancelable_hasta timestamptz,
    observaciones varchar(1000),
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    version int NOT NULL DEFAULT 0,
    CONSTRAINT ck_reserva_titular_documento CHECK (
      (titular_tipo_documento = 'CEDULA' AND titular_numero_documento ~ '^[0-9]{10}$')
      OR (titular_tipo_documento = 'RUC' AND titular_numero_documento ~ '^[0-9]{13}$')
      OR (titular_tipo_documento = 'PASAPORTE' AND titular_numero_documento ~ '^[A-Za-z0-9]{6,9}$'))
  )`,
  `CREATE INDEX ix_reserva_principal ON reserva (principal_tipo, principal_id, fecha DESC)`,
  `CREATE INDEX ix_reserva_atraccion_fecha ON reserva (atraccion_codigo, fecha)`,
  `CREATE INDEX ix_reserva_estado_fecha ON reserva (estado, fecha)`,
  `CREATE INDEX ix_reserva_guia ON reserva (guia_codigo)`,

  `CREATE TABLE reserva_boleto (
    reserva_id uuid NOT NULL CONSTRAINT fk_reserva_boleto_reserva REFERENCES reserva (id) ON DELETE CASCADE,
    tipo_boleto varchar(10) NOT NULL CONSTRAINT ck_reserva_boleto_tipo CHECK (tipo_boleto IN ${sqlList(TIPOS_BOLETO)}),
    cantidad smallint NOT NULL CONSTRAINT ck_reserva_boleto_cantidad CHECK (cantidad > 0),
    CONSTRAINT pk_reserva_boleto PRIMARY KEY (reserva_id, tipo_boleto)
  )`,

  `CREATE TABLE reserva_pasajero (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reserva_id uuid NOT NULL CONSTRAINT fk_reserva_pasajero_reserva REFERENCES reserva (id) ON DELETE CASCADE,
    nombre_completo varchar(200) NOT NULL,
    numero_documento varchar(13),
    tipo_boleto varchar(10) NOT NULL CONSTRAINT ck_reserva_pasajero_tipo CHECK (tipo_boleto IN ${sqlList(TIPOS_BOLETO)})
  )`,
  `CREATE INDEX ix_reserva_pasajero_reserva ON reserva_pasajero (reserva_id)`,

  `CREATE TABLE reserva_checkin (
    reserva_id uuid PRIMARY KEY CONSTRAINT fk_reserva_checkin_reserva REFERENCES reserva (id) ON DELETE CASCADE,
    realizado_en timestamptz NOT NULL,
    guia_codigo varchar(40),
    dispositivo varchar(80),
    documento_presentado varchar(13) NOT NULL
  )`,

  `CREATE TABLE reserva_cancelacion (
    reserva_id uuid PRIMARY KEY CONSTRAINT fk_reserva_cancelacion_reserva REFERENCES reserva (id) ON DELETE CASCADE,
    motivo varchar(500) NOT NULL,
    solicitante varchar(20) NOT NULL CONSTRAINT ck_reserva_cancelacion_solicitante CHECK (solicitante IN ${sqlList(SOLICITANTES_CANCELACION)}),
    cancelado_en timestamptz NOT NULL,
    reembolso_codigo varchar(30) CONSTRAINT uq_reserva_cancelacion_reembolso UNIQUE,
    monto_reembolsado numeric(10,2) CONSTRAINT ck_reserva_cancelacion_monto CHECK (monto_reembolsado >= 0),
    CONSTRAINT ck_reserva_cancelacion_reembolso CHECK ((reembolso_codigo IS NULL) = (monto_reembolsado IS NULL))
  )`,

  // El estado y sus tablas de detalle deben coincidir; se comprueba al confirmar la transacción.
  `CREATE FUNCTION tg_reserva_estado_coherente() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE v_reserva uuid;
   DECLARE v_estado varchar(12);
   BEGIN
     IF TG_TABLE_NAME = 'reserva' THEN
       v_reserva := NEW.id;
     ELSE
       v_reserva := OLD.reserva_id;
     END IF;
     SELECT estado INTO v_estado FROM reserva WHERE id = v_reserva;
     IF v_estado IS NULL THEN RETURN NULL; END IF;
     IF (v_estado = 'CANCELLED') <> EXISTS (SELECT 1 FROM reserva_cancelacion WHERE reserva_id = v_reserva) THEN
       RAISE EXCEPTION 'La reserva % está en estado % y no coincide con reserva_cancelacion', v_reserva, v_estado USING ERRCODE = '23514';
     END IF;
     IF v_estado IN ('CHECKED_IN', 'COMPLETED') AND NOT EXISTS (SELECT 1 FROM reserva_checkin WHERE reserva_id = v_reserva) THEN
       RAISE EXCEPTION 'La reserva % está en estado % sin check-in', v_reserva, v_estado USING ERRCODE = '23514';
     END IF;
     RETURN NULL;
   END $$`,
  `CREATE CONSTRAINT TRIGGER tg_reserva_estado_coherente AFTER INSERT OR UPDATE OF estado ON reserva
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tg_reserva_estado_coherente()`,
  `CREATE CONSTRAINT TRIGGER tg_reserva_checkin_coherente AFTER DELETE ON reserva_checkin
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tg_reserva_estado_coherente()`,
  `CREATE CONSTRAINT TRIGGER tg_reserva_cancelacion_coherente AFTER DELETE ON reserva_cancelacion
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tg_reserva_estado_coherente()`,

  `CREATE TABLE reserva_historial_estado (
    id bigserial PRIMARY KEY,
    reserva_id uuid NOT NULL CONSTRAINT fk_reserva_historial_reserva REFERENCES reserva (id) ON DELETE CASCADE,
    estado varchar(12) NOT NULL CONSTRAINT ck_reserva_historial_estado CHECK (estado IN ${sqlList(ESTADOS_RESERVA)}),
    motivo varchar(500),
    correlation_id varchar(100) NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX ix_reserva_historial_reserva ON reserva_historial_estado (reserva_id, id)`,

  ...idempotenciaDdl(),
  ...outboxDdl(),
];

const DOWN = [
  'DROP TABLE outbox',
  'DROP TABLE idempotencia',
  'DROP TABLE reserva_historial_estado',
  'DROP TABLE reserva_cancelacion',
  'DROP TABLE reserva_checkin',
  'DROP TABLE reserva_pasajero',
  'DROP TABLE reserva_boleto',
  'DROP TABLE reserva',
  'DROP FUNCTION tg_reserva_estado_coherente()',
];

export class BookingSchema1793000000000 implements MigrationInterface {
  name = 'BookingSchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
