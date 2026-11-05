import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Datos de facturación de los turistas que registra un socio en Identity (`cliente_api` con `cla_tipo = 'TURISTA'`).
 * Cada fila pertenece a un usuario web (`usu_id`) o a un turista (`cla_id`), nunca a los dos.
 */
const UP = String.raw`ALTER TABLE dato_facturacion ALTER COLUMN usu_id DROP NOT NULL;
ALTER TABLE dato_facturacion ADD COLUMN cla_id BIGINT;            -- ID logico (Identity, cliente_api TURISTA)
ALTER TABLE dato_facturacion ADD CONSTRAINT dato_facturacion_un_titular
    CHECK ((usu_id IS NOT NULL) <> (cla_id IS NOT NULL));
ALTER TABLE dato_facturacion ADD CONSTRAINT uq_dato_facturacion_cliente_identificacion
    UNIQUE (cla_id, dfa_tipo_identificacion, dfa_identificacion);
CREATE UNIQUE INDEX ux_dato_facturacion_principal_cliente
    ON dato_facturacion (cla_id) WHERE dfa_es_principal AND cla_id IS NOT NULL;
CREATE INDEX ix_dato_facturacion_cla_id ON dato_facturacion (cla_id);`;

const DOWN = [
  'DROP INDEX ix_dato_facturacion_cla_id',
  'DROP INDEX ux_dato_facturacion_principal_cliente',
  'ALTER TABLE dato_facturacion DROP CONSTRAINT uq_dato_facturacion_cliente_identificacion',
  'ALTER TABLE dato_facturacion DROP CONSTRAINT dato_facturacion_un_titular',
  'DELETE FROM dato_facturacion WHERE cla_id IS NOT NULL',
  'ALTER TABLE dato_facturacion DROP COLUMN cla_id',
  'ALTER TABLE dato_facturacion ALTER COLUMN usu_id SET NOT NULL',
];

export class FacturacionClienteApi1796000000400 implements MigrationInterface {
  name = 'FacturacionClienteApi1796000000400';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of DOWN) await queryRunner.query(sentence);
  }
}
