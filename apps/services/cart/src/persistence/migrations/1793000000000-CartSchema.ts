import { sqlList, TIPOS_BOLETO } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de cart_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 5). */
const UP = [
  `CREATE TABLE carrito (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid NOT NULL,
    estado varchar(12) NOT NULL DEFAULT 'ACTIVO' CONSTRAINT ck_carrito_estado CHECK (estado IN ('ACTIVO', 'CONVERTIDO', 'ABANDONADO')),
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    expira_en timestamptz NOT NULL
  )`,
  `CREATE UNIQUE INDEX uq_carrito_activo ON carrito (usuario_id) WHERE estado = 'ACTIVO'`,

  `CREATE TABLE carrito_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    carrito_id uuid NOT NULL CONSTRAINT fk_carrito_item_carrito REFERENCES carrito (id) ON DELETE CASCADE,
    atraccion_codigo char(12) NOT NULL,
    fecha date NOT NULL,
    hora time NOT NULL,
    agregado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_carrito_item_turno UNIQUE (carrito_id, atraccion_codigo, fecha, hora)
  )`,
  `CREATE TABLE carrito_item_boleto (
    carrito_item_id uuid NOT NULL CONSTRAINT fk_carrito_item_boleto_item REFERENCES carrito_item (id) ON DELETE CASCADE,
    tipo_boleto varchar(10) NOT NULL CONSTRAINT ck_carrito_item_boleto_tipo CHECK (tipo_boleto IN ${sqlList(TIPOS_BOLETO)}),
    cantidad smallint NOT NULL CONSTRAINT ck_carrito_item_boleto_cantidad CHECK (cantidad > 0),
    CONSTRAINT pk_carrito_item_boleto PRIMARY KEY (carrito_item_id, tipo_boleto)
  )`,

  `CREATE TABLE favorito (
    usuario_id uuid NOT NULL,
    atraccion_codigo char(12) NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_favorito PRIMARY KEY (usuario_id, atraccion_codigo)
  )`,
];

const DOWN = ['DROP TABLE favorito', 'DROP TABLE carrito_item_boleto', 'DROP TABLE carrito_item', 'DROP TABLE carrito'];

export class CartSchema1793000000000 implements MigrationInterface {
  name = 'CartSchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
