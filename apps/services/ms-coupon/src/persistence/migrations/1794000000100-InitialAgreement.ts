import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Acuerdo inicial: sin promociones y vigente un año, para que `GET /atracciones/promociones/contrato` siempre tenga
 * qué responder (`vigencia_hasta` es obligatorio) hasta que el administrador responda el cuestionario con `PUT`.
 */
export class InitialAgreement1794000000100 implements MigrationInterface {
  name = 'InitialAgreement1794000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO acuerdo_promocion (apr_proveedor_codigo, apr_nombre_comercial, apr_permite_promociones, apr_porcentaje_descuento_max, apr_vigencia_hasta)
       VALUES ('proveedor-atracciones-dilan', 'Descubre EC', FALSE, 0, (CURRENT_DATE + INTERVAL '1 year')::date)
       ON CONFLICT ON CONSTRAINT uq_acuerdo_promocion_proveedor DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM acuerdo_promocion WHERE apr_proveedor_codigo = 'proveedor-atracciones-dilan'`);
  }
}
