import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de ms_cart (Plan/ms_cart/ms_cart.sql): carrito e ítems con su estado de compra. */
const UP = [
  `CREATE FUNCTION fn_actualizar_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
     RETURN NEW;
   END $$`,

  // car_activo pasa a FALSE solo cuando el carrito se abandona; pagar un ítem no lo desactiva.
  `CREATE TABLE carrito (
    car_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id varchar(64) NOT NULL,
    car_activo boolean NOT NULL DEFAULT TRUE,
    car_creado_en timestamptz NOT NULL DEFAULT now(),
    car_actualizado_en timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX ix_carrito_usu_id ON carrito (usu_id)`,
  `CREATE UNIQUE INDEX ux_carrito_activo ON carrito (usu_id) WHERE car_activo`,

  `CREATE TABLE carrito_item (
    cai_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    car_id bigint NOT NULL,
    atr_codigo char(12) NOT NULL,
    dis_slot_codigo varchar(40),
    cai_adultos integer NOT NULL DEFAULT 1,
    cai_ninos integer NOT NULL DEFAULT 0,
    cai_seniors integer NOT NULL DEFAULT 0,
    cai_estudiantes integer NOT NULL DEFAULT 0,
    cai_infantes integer NOT NULL DEFAULT 0,
    cai_estado varchar(10) NOT NULL DEFAULT 'PENDIENTE',
    cai_ord_numero varchar(20),
    cai_orden_clave uuid,
    cai_en_pago_desde timestamptz,
    cai_comprado_en timestamptz,
    cai_creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT carrito_item_cantidades_validas
      CHECK (cai_adultos >= 1 AND cai_ninos >= 0 AND cai_seniors >= 0 AND cai_estudiantes >= 0 AND cai_infantes >= 0),
    CONSTRAINT carrito_item_atr_codigo_formato CHECK (atr_codigo ~ '^[A-Za-z0-9]{12}$'),
    CONSTRAINT carrito_item_slot_formato CHECK (dis_slot_codigo IS NULL OR dis_slot_codigo ~ '^slot-[0-9]{8}-[0-9]{4}$'),
    CONSTRAINT carrito_item_estado_valido CHECK (cai_estado IN ('PENDIENTE', 'EN_PAGO', 'COMPRADO')),
    CONSTRAINT carrito_item_compra_coherente CHECK (
      (cai_estado = 'PENDIENTE'
        AND cai_ord_numero IS NULL AND cai_orden_clave IS NULL AND cai_en_pago_desde IS NULL AND cai_comprado_en IS NULL)
      OR (cai_estado = 'EN_PAGO' AND dis_slot_codigo IS NOT NULL
        AND cai_ord_numero IS NOT NULL AND cai_orden_clave IS NOT NULL AND cai_en_pago_desde IS NOT NULL AND cai_comprado_en IS NULL)
      OR (cai_estado = 'COMPRADO' AND dis_slot_codigo IS NOT NULL
        AND cai_ord_numero IS NOT NULL AND cai_orden_clave IS NOT NULL AND cai_en_pago_desde IS NOT NULL AND cai_comprado_en IS NOT NULL)
    ),
    CONSTRAINT uq_carrito_item_ord_numero UNIQUE (cai_ord_numero),
    CONSTRAINT fk_carrito_item_carrito FOREIGN KEY (car_id) REFERENCES carrito (car_id) ON UPDATE CASCADE ON DELETE CASCADE
  )`,
  `CREATE INDEX ix_carrito_item_car_id ON carrito_item (car_id)`,
  `CREATE INDEX ix_carrito_item_atr_codigo ON carrito_item (atr_codigo)`,
  `CREATE INDEX ix_carrito_item_en_pago ON carrito_item (cai_en_pago_desde) WHERE cai_estado = 'EN_PAGO'`,
  // Un ítem por atracción + turno (y uno solo sin turno); los comprados no cuentan.
  `CREATE UNIQUE INDEX ux_carrito_item_con_turno ON carrito_item (car_id, atr_codigo, dis_slot_codigo)
     WHERE dis_slot_codigo IS NOT NULL AND cai_estado <> 'COMPRADO'`,
  `CREATE UNIQUE INDEX ux_carrito_item_sin_turno ON carrito_item (car_id, atr_codigo)
     WHERE dis_slot_codigo IS NULL AND cai_estado <> 'COMPRADO'`,

  `CREATE TRIGGER trg_carrito_actualizado BEFORE UPDATE ON carrito
     FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('car_actualizado_en')`,
];

const DOWN = ['DROP TABLE carrito_item', 'DROP TABLE carrito', 'DROP FUNCTION fn_actualizar_timestamp()'];

export class CartSchema1794000000000 implements MigrationInterface {
  name = 'CartSchema1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
