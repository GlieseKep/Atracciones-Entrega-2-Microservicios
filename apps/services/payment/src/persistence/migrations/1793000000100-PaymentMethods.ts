import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Los cuatro métodos de pago de `CreateReservaRequestV2.payment_method`. */
const METODOS: [string, string][] = [
  ['TARJETA_CREDITO', 'Tarjeta de crédito'],
  ['TRANSFERENCIA', 'Transferencia bancaria'],
  ['SOA_BOOKING_GATEWAY', 'Cobrado por Booking Prototipo'],
  ['PAGO_EN_SITIO', 'Pago en el punto de encuentro'],
];

export class PaymentMethods1793000000100 implements MigrationInterface {
  name = 'PaymentMethods1793000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [codigo, nombre] of METODOS) {
      await queryRunner.query(`INSERT INTO metodo_pago (codigo, nombre) VALUES ($1, $2) ON CONFLICT (codigo) DO NOTHING`, [codigo, nombre]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM metodo_pago WHERE codigo = ANY($1::varchar[])`, [METODOS.map(([codigo]) => codigo)]);
  }
}
