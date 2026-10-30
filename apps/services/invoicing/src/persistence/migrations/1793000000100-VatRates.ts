import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Códigos de tarifa de IVA del SRI usados por la tienda: `0` (0 %) y `4` (15 %, vigente desde el 1 de abril de 2024).
 * Otros códigos se agregan con nuevas migraciones cuando se necesiten.
 */
const TARIFAS: [string, number, string | null][] = [
  ['0', 0, null],
  ['4', 15, '2024-04-01'],
];

export class VatRates1793000000100 implements MigrationInterface {
  name = 'VatRates1793000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [codigo, porcentaje, desde] of TARIFAS) {
      await queryRunner.query(
        `INSERT INTO tarifa_iva (codigo, porcentaje, vigente_desde) VALUES ($1, $2, $3) ON CONFLICT (codigo) DO NOTHING`,
        [codigo, porcentaje, desde],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM tarifa_iva WHERE codigo = ANY($1::varchar[])`, [TARIFAS.map(([codigo]) => codigo)]);
  }
}
