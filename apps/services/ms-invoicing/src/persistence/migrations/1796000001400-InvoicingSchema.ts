import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL y estados literales de Plan/ms_invoicing/ms_invoicing.sql. */
const UP = String.raw`CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');
CREATE DOMAIN dom_porcentaje AS NUMERIC(5,2)
    CHECK (VALUE >= 0 AND VALUE <= 100);
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

-- Estados propios de la factura (sin est_grupo).
CREATE TABLE estado (
    est_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    est_codigo VARCHAR(20) NOT NULL UNIQUE,
    est_nombre VARCHAR(50) NOT NULL,
    est_final  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE factura (
    fac_id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_id               BIGINT       NOT NULL,      -- ID logico (Order)
    dfa_id               BIGINT,                     -- ID logico (Billing Profile)
    fac_numero           VARCHAR(20)  NOT NULL UNIQUE,
    fac_clave_acceso     VARCHAR(49),                -- clave de acceso SRI
    fac_autorizacion_sri VARCHAR(49),
    -- Cola de envio al SRI (arquitectura, medida 9): reintento exponencial.
    fac_estado_sri       VARCHAR(15)  NOT NULL DEFAULT 'PENDIENTE',
    fac_intentos         SMALLINT     NOT NULL DEFAULT 0,
    fac_proximo_intento_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    fac_mensaje_sri      VARCHAR(500),
    est_id               SMALLINT     NOT NULL,
    fac_emitida_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    fac_subtotal         dom_importe  NOT NULL,
    fac_descuento        dom_importe  NOT NULL DEFAULT 0,
    fac_iva              dom_importe  NOT NULL DEFAULT 0,
    fac_total            dom_importe  NOT NULL,
    -- Snapshot del comprador al momento de emitir
    fac_tipo_identificacion VARCHAR(20)  NOT NULL,
    fac_identificacion      VARCHAR(20)  NOT NULL,
    fac_razon_social        VARCHAR(150) NOT NULL,
    fac_correo              dom_correo   NOT NULL,
    fac_telefono            dom_telefono,
    CONSTRAINT factura_estado_sri_valido
        CHECK (fac_estado_sri IN ('PENDIENTE', 'AUTORIZADA', 'RECHAZADA')),
    CONSTRAINT factura_autorizada_coherente
        CHECK ((fac_estado_sri = 'AUTORIZADA') = (fac_autorizacion_sri IS NOT NULL)),
    CONSTRAINT factura_intentos_validos CHECK (fac_intentos >= 0),
    CONSTRAINT factura_tipo_identificacion_valido
        CHECK (fac_tipo_identificacion IN ('CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL')),
    CONSTRAINT factura_total_coherente
        CHECK (fac_total = fac_subtotal - fac_descuento + fac_iva),
    CONSTRAINT uq_factura_orden UNIQUE (ord_id),
    CONSTRAINT fk_factura_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_factura_dfa_id ON factura (dfa_id);
CREATE INDEX ix_factura_est_id ON factura (est_id);
CREATE INDEX ix_factura_cola_sri ON factura (fac_proximo_intento_en) WHERE fac_estado_sri = 'PENDIENTE';

-- Secuencial del comprobante (fac_numero = 001-001-000000001).
CREATE SEQUENCE seq_factura_secuencial;

CREATE TABLE factura_detalle (
    fde_id              BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fac_id              BIGINT         NOT NULL,
    det_id              BIGINT         NOT NULL,     -- ID logico (Order)
    fde_codigo          VARCHAR(25)    NOT NULL,     -- codigo principal del producto (SRI)
    fde_descripcion     VARCHAR(300)   NOT NULL,
    fde_cantidad        INTEGER        NOT NULL,
    fde_precio_unitario dom_importe    NOT NULL,
    fde_descuento       dom_importe    NOT NULL DEFAULT 0,
    fde_subtotal        dom_importe    NOT NULL,
    fde_iva_porcentaje  dom_porcentaje NOT NULL DEFAULT 0,
    fde_iva             dom_importe    NOT NULL DEFAULT 0,
    fde_total           dom_importe    NOT NULL,
    CONSTRAINT factura_detalle_cantidad_valida CHECK (fde_cantidad > 0),
    CONSTRAINT factura_detalle_subtotal_coherente
        CHECK (fde_subtotal = fde_cantidad * fde_precio_unitario - fde_descuento),
    CONSTRAINT factura_detalle_total_coherente
        CHECK (fde_total = fde_subtotal + fde_iva),
    -- Una linea de orden se factura una sola vez
    CONSTRAINT uq_factura_detalle_det_id UNIQUE (det_id),
    CONSTRAINT fk_factura_detalle_factura
        FOREIGN KEY (fac_id) REFERENCES factura (fac_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_factura_detalle_fac_id ON factura_detalle (fac_id);

INSERT INTO estado (est_codigo, est_nombre, est_final) VALUES
    ('NO_PAGADA', 'Factura no pagada', FALSE),
    ('PAGADA',    'Factura pagada',    TRUE),
    ('ANULADA',   'Factura anulada',   TRUE);

-- Transactional Outbox: FacturaAutorizada.
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

const DOWN = [
  'DROP TABLE outbox',
  'DROP TABLE factura_detalle',
  'DROP SEQUENCE seq_factura_secuencial',
  'DROP TABLE factura',
  'DROP TABLE estado',
  'DROP DOMAIN dom_importe',
  'DROP DOMAIN dom_porcentaje',
  'DROP DOMAIN dom_telefono',
  'DROP DOMAIN dom_correo',
];

export class InvoicingSchema1796000001400 implements MigrationInterface {
  name = 'InvoicingSchema1796000001400';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of DOWN) await queryRunner.query(sentence);
  }
}
