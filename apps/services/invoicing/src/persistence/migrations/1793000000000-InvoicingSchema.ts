import { outboxDdl } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de invoicing_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 9). */
const UP = [
  `CREATE TABLE tarifa_iva (
    codigo varchar(4) PRIMARY KEY,
    porcentaje numeric(5,2) NOT NULL CONSTRAINT ck_tarifa_iva_porcentaje CHECK (porcentaje BETWEEN 0 AND 100),
    vigente_desde date
  )`,

  `CREATE TABLE factura (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_id uuid NOT NULL,
    tipo_comprobante varchar(12) NOT NULL CONSTRAINT ck_factura_tipo CHECK (tipo_comprobante IN ('FACTURA', 'NOTA_CREDITO')),
    factura_origen_id uuid CONSTRAINT fk_factura_origen REFERENCES factura (id),
    establecimiento char(3) NOT NULL CONSTRAINT ck_factura_establecimiento CHECK (establecimiento ~ '^[0-9]{3}$'),
    punto_emision char(3) NOT NULL CONSTRAINT ck_factura_punto_emision CHECK (punto_emision ~ '^[0-9]{3}$'),
    secuencial char(9) NOT NULL CONSTRAINT ck_factura_secuencial CHECK (secuencial ~ '^[0-9]{9}$'),
    clave_acceso char(49) NOT NULL CONSTRAINT uq_factura_clave_acceso UNIQUE CONSTRAINT ck_factura_clave_acceso CHECK (clave_acceso ~ '^[0-9]{49}$'),
    ambiente varchar(10) NOT NULL CONSTRAINT ck_factura_ambiente CHECK (ambiente IN ('PRUEBAS', 'PRODUCCION')),
    comprador_tipo_identificacion char(2) NOT NULL CONSTRAINT ck_factura_comprador_tipo CHECK (comprador_tipo_identificacion IN ('04', '05', '06', '07', '08')),
    comprador_identificacion varchar(20) NOT NULL,
    comprador_razon_social varchar(300) NOT NULL,
    comprador_email varchar(254),
    comprador_direccion varchar(300),
    estado_sri varchar(15) NOT NULL DEFAULT 'PENDIENTE' CONSTRAINT ck_factura_estado_sri CHECK (estado_sri IN
      ('PENDIENTE', 'ENVIADA', 'RECIBIDA', 'DEVUELTA', 'AUTORIZADA', 'NO_AUTORIZADA')),
    numero_autorizacion varchar(49),
    fecha_autorizacion timestamptz,
    xml_firmado text,
    intentos smallint NOT NULL DEFAULT 0 CONSTRAINT ck_factura_intentos CHECK (intentos >= 0),
    proximo_intento_en timestamptz,
    correlation_id varchar(100) NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_factura_orden UNIQUE (orden_id, tipo_comprobante),
    CONSTRAINT uq_factura_numero UNIQUE (tipo_comprobante, establecimiento, punto_emision, secuencial),
    CONSTRAINT ck_factura_origen CHECK ((tipo_comprobante = 'NOTA_CREDITO') = (factura_origen_id IS NOT NULL)),
    CONSTRAINT ck_factura_autorizacion CHECK ((estado_sri = 'AUTORIZADA') = (numero_autorizacion IS NOT NULL AND fecha_autorizacion IS NOT NULL))
  )`,
  // Cola de envío al SRI con reintento exponencial.
  `CREATE INDEX ix_factura_cola_sri ON factura (proximo_intento_en) WHERE estado_sri IN ('PENDIENTE', 'ENVIADA', 'RECIBIDA')`,

  `CREATE TABLE factura_detalle (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factura_id uuid NOT NULL CONSTRAINT fk_factura_detalle_factura REFERENCES factura (id) ON DELETE CASCADE,
    codigo_principal varchar(25) NOT NULL,
    descripcion varchar(300) NOT NULL,
    cantidad numeric(10,2) NOT NULL CONSTRAINT ck_factura_detalle_cantidad CHECK (cantidad > 0),
    precio_unitario numeric(14,6) NOT NULL CONSTRAINT ck_factura_detalle_precio CHECK (precio_unitario >= 0),
    descuento numeric(10,2) NOT NULL DEFAULT 0 CONSTRAINT ck_factura_detalle_descuento CHECK (descuento >= 0),
    codigo_tarifa_iva varchar(4) NOT NULL CONSTRAINT fk_factura_detalle_tarifa_iva REFERENCES tarifa_iva (codigo),
    CONSTRAINT ck_factura_detalle_base CHECK (descuento <= cantidad * precio_unitario)
  )`,
  `CREATE INDEX ix_factura_detalle_factura ON factura_detalle (factura_id)`,

  `CREATE TABLE factura_mensaje_sri (
    id bigserial PRIMARY KEY,
    factura_id uuid NOT NULL CONSTRAINT fk_factura_mensaje_sri_factura REFERENCES factura (id) ON DELETE CASCADE,
    identificador varchar(10) NOT NULL,
    tipo varchar(15) NOT NULL CONSTRAINT ck_factura_mensaje_sri_tipo CHECK (tipo IN ('ERROR', 'ADVERTENCIA', 'INFORMATIVO')),
    mensaje varchar(500) NOT NULL,
    informacion_adicional varchar(1000),
    recibido_en timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX ix_factura_mensaje_sri_factura ON factura_mensaje_sri (factura_id)`,

  ...outboxDdl(),

  // Subtotales, IVA y total de cada comprobante a partir de su detalle; base e IVA se redondean por línea, igual que en el XML.
  `CREATE VIEW v_factura_totales AS
     SELECT f.id AS factura_id,
            coalesce(sum(d.base) FILTER (WHERE d.porcentaje = 0), 0)::numeric(10,2) AS subtotal_sin_iva,
            coalesce(sum(d.base) FILTER (WHERE d.porcentaje > 0), 0)::numeric(10,2) AS subtotal_con_iva,
            coalesce(sum(round(d.base * d.porcentaje / 100, 2)), 0)::numeric(10,2) AS iva,
            coalesce(sum(d.base + round(d.base * d.porcentaje / 100, 2)), 0)::numeric(10,2) AS total
       FROM factura f
       LEFT JOIN (SELECT fd.factura_id, round(fd.cantidad * fd.precio_unitario - fd.descuento, 2) AS base, t.porcentaje
                    FROM factura_detalle fd JOIN tarifa_iva t ON t.codigo = fd.codigo_tarifa_iva) d
              ON d.factura_id = f.id
      GROUP BY f.id`,
];

const DOWN = [
  'DROP VIEW v_factura_totales',
  'DROP TABLE outbox',
  'DROP TABLE factura_mensaje_sri',
  'DROP TABLE factura_detalle',
  'DROP TABLE factura',
  'DROP TABLE tarifa_iva',
];

export class InvoicingSchema1793000000000 implements MigrationInterface {
  name = 'InvoicingSchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
