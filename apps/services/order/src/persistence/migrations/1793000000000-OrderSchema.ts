import { idempotenciaDdl, METODOS_PAGO, outboxDdl, sqlList, TIPOS_BOLETO, TIPOS_PRINCIPAL } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de order_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 6). */
const UP = [
  `CREATE TABLE orden (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_externo varchar(30) NOT NULL CONSTRAINT uq_orden_codigo_externo UNIQUE,
    principal_tipo varchar(12) NOT NULL CONSTRAINT ck_orden_principal_tipo CHECK (principal_tipo IN ${sqlList(TIPOS_PRINCIPAL)}),
    principal_id uuid NOT NULL,
    saga_id varchar(60),
    node_id varchar(80),
    metodo_pago varchar(25) NOT NULL CONSTRAINT ck_orden_metodo_pago CHECK (metodo_pago IN ${sqlList(METODOS_PAGO)}),
    estado varchar(12) NOT NULL DEFAULT 'PENDIENTE' CONSTRAINT ck_orden_estado CHECK (estado IN ('PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'FALLIDA')),
    estado_saga varchar(20) NOT NULL DEFAULT 'INICIADA' CONSTRAINT ck_orden_estado_saga CHECK (estado_saga IN
      ('INICIADA', 'CUPOS_RESERVADOS', 'PAGO_REGISTRADO', 'RESERVA_EMITIDA', 'COMPLETADA', 'COMPENSANDO', 'COMPENSADA')),
    moneda char(3) NOT NULL DEFAULT 'USD' CONSTRAINT ck_orden_moneda CHECK (moneda ~ '^[A-Z]{3}$'),
    correlation_id varchar(100) NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    version int NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX ix_orden_principal ON orden (principal_tipo, principal_id, creado_en DESC)`,
  // Sagas sin terminar: las recorre el worker de recuperación.
  `CREATE INDEX ix_orden_saga_abierta ON orden (estado_saga, actualizado_en) WHERE estado_saga NOT IN ('COMPLETADA', 'COMPENSADA')`,

  `CREATE TABLE orden_detalle (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_id uuid NOT NULL CONSTRAINT fk_orden_detalle_orden REFERENCES orden (id) ON DELETE CASCADE,
    atraccion_codigo char(12) NOT NULL,
    fecha date NOT NULL,
    hora time NOT NULL,
    CONSTRAINT uq_orden_detalle_turno UNIQUE (orden_id, atraccion_codigo, fecha, hora)
  )`,
  `CREATE INDEX ix_orden_detalle_turno ON orden_detalle (atraccion_codigo, fecha)`,
  `CREATE TABLE orden_detalle_boleto (
    orden_detalle_id uuid NOT NULL CONSTRAINT fk_orden_detalle_boleto_detalle REFERENCES orden_detalle (id) ON DELETE CASCADE,
    tipo_boleto varchar(10) NOT NULL CONSTRAINT ck_orden_detalle_boleto_tipo CHECK (tipo_boleto IN ${sqlList(TIPOS_BOLETO)}),
    cantidad smallint NOT NULL CONSTRAINT ck_orden_detalle_boleto_cantidad CHECK (cantidad > 0),
    precio_unitario numeric(10,2) NOT NULL CONSTRAINT ck_orden_detalle_boleto_precio CHECK (precio_unitario >= 0),
    CONSTRAINT pk_orden_detalle_boleto PRIMARY KEY (orden_detalle_id, tipo_boleto)
  )`,
  // `adult_count` tiene minimum 1 en el contrato: todo detalle debe tener boletos de adulto.
  `CREATE FUNCTION tg_orden_detalle_con_adulto() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE v_detalle uuid;
   BEGIN
     -- Ramas separadas: cada sentencia se planifica solo si se ejecuta (orden_detalle_boleto no tiene columna id).
     IF TG_TABLE_NAME = 'orden_detalle' THEN
       v_detalle := NEW.id;
     ELSE
       v_detalle := OLD.orden_detalle_id;
     END IF;
     IF EXISTS (SELECT 1 FROM orden_detalle WHERE id = v_detalle)
        AND NOT EXISTS (SELECT 1 FROM orden_detalle_boleto WHERE orden_detalle_id = v_detalle AND tipo_boleto = 'ADULT') THEN
       RAISE EXCEPTION 'El detalle de orden % no tiene boletos de adulto', v_detalle USING ERRCODE = '23514';
     END IF;
     RETURN NULL;
   END $$`,
  `CREATE CONSTRAINT TRIGGER tg_orden_detalle_con_adulto AFTER INSERT ON orden_detalle
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tg_orden_detalle_con_adulto()`,
  `CREATE CONSTRAINT TRIGGER tg_orden_detalle_boleto_con_adulto AFTER UPDATE OR DELETE ON orden_detalle_boleto
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tg_orden_detalle_con_adulto()`,

  `CREATE TABLE orden_paso_saga (
    id bigserial PRIMARY KEY,
    orden_id uuid NOT NULL CONSTRAINT fk_orden_paso_saga_orden REFERENCES orden (id) ON DELETE CASCADE,
    paso varchar(30) NOT NULL CONSTRAINT ck_orden_paso_saga_paso CHECK (paso IN ('RESERVAR_CUPOS', 'REGISTRAR_PAGO', 'EMITIR_RESERVA')),
    accion varchar(10) NOT NULL CONSTRAINT ck_orden_paso_saga_accion CHECK (accion IN ('EJECUTAR', 'COMPENSAR')),
    resultado varchar(10) NOT NULL CONSTRAINT ck_orden_paso_saga_resultado CHECK (resultado IN ('OK', 'ERROR')),
    detalle varchar(500),
    creado_en timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX ix_orden_paso_saga_orden ON orden_paso_saga (orden_id, id)`,

  `CREATE TABLE cupon (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo varchar(30) NOT NULL CONSTRAINT uq_cupon_codigo UNIQUE,
    tipo varchar(10) NOT NULL CONSTRAINT ck_cupon_tipo CHECK (tipo IN ('PORCENTAJE', 'MONTO')),
    valor numeric(10,2) NOT NULL CONSTRAINT ck_cupon_valor CHECK (valor > 0),
    vigente_desde date NOT NULL,
    vigente_hasta date NOT NULL,
    usos_maximos int CONSTRAINT ck_cupon_usos_maximos CHECK (usos_maximos > 0),
    activo boolean NOT NULL DEFAULT true,
    CONSTRAINT ck_cupon_vigencia CHECK (vigente_hasta >= vigente_desde),
    CONSTRAINT ck_cupon_porcentaje CHECK (tipo <> 'PORCENTAJE' OR valor <= 100)
  )`,
  `CREATE TABLE orden_cupon (
    orden_id uuid NOT NULL CONSTRAINT fk_orden_cupon_orden REFERENCES orden (id) ON DELETE CASCADE,
    cupon_id uuid NOT NULL CONSTRAINT fk_orden_cupon_cupon REFERENCES cupon (id),
    monto_descuento numeric(10,2) NOT NULL CONSTRAINT ck_orden_cupon_monto CHECK (monto_descuento >= 0),
    CONSTRAINT pk_orden_cupon PRIMARY KEY (orden_id, cupon_id)
  )`,
  `CREATE INDEX ix_orden_cupon_cupon ON orden_cupon (cupon_id)`,

  ...idempotenciaDdl(),
  ...outboxDdl(),

  // total_price / precio_total del contrato.
  `CREATE VIEW v_orden_total AS
     SELECT o.id AS orden_id,
            o.moneda,
            coalesce(b.subtotal, 0)::numeric(10,2) AS subtotal,
            coalesce(c.descuento, 0)::numeric(10,2) AS descuento,
            greatest(coalesce(b.subtotal, 0) - coalesce(c.descuento, 0), 0)::numeric(10,2) AS total
       FROM orden o
       LEFT JOIN (SELECT d.orden_id, sum(ob.cantidad * ob.precio_unitario) AS subtotal
                    FROM orden_detalle d JOIN orden_detalle_boleto ob ON ob.orden_detalle_id = d.id
                   GROUP BY d.orden_id) b ON b.orden_id = o.id
       LEFT JOIN (SELECT orden_id, sum(monto_descuento) AS descuento FROM orden_cupon GROUP BY orden_id) c ON c.orden_id = o.id`,
];

const DOWN = [
  'DROP VIEW v_orden_total',
  'DROP TABLE outbox',
  'DROP TABLE idempotencia',
  'DROP TABLE orden_cupon',
  'DROP TABLE cupon',
  'DROP TABLE orden_paso_saga',
  'DROP TABLE orden_detalle_boleto',
  'DROP TABLE orden_detalle',
  'DROP FUNCTION tg_orden_detalle_con_adulto()',
  'DROP TABLE orden',
];

export class OrderSchema1793000000000 implements MigrationInterface {
  name = 'OrderSchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
