import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Espera antes de reintentar un stock que Booking respondió con `ITEM_NOT_FOUND` (`Plan/PLAN_REQUISITOS_DEFENSA.md`).
 * DDL de `Plan/ms_inventory/ms_inventory.sql`.
 */
export class InventoryStockRetry1796000000520 implements MigrationInterface {
  name = 'InventoryStockRetry1796000000520';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE outbox ADD COLUMN proximo_en TIMESTAMPTZ');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE outbox DROP COLUMN proximo_en');
  }
}
