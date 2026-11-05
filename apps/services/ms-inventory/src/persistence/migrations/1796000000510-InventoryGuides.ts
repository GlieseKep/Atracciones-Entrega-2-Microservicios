import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guía por horario y por turno (`Plan/PLAN_GUIA_POR_HORARIO.md`). `gui_id` es un ID lógico de Catalog (sin FK):
 * el horario guarda el guía por defecto y cada turno, el suyo. DDL de `Plan/ms_inventory/ms_inventory.sql`.
 */
const UP = String.raw`ALTER TABLE horario ADD COLUMN gui_id BIGINT;
ALTER TABLE disponibilidad ADD COLUMN gui_id BIGINT;
CREATE INDEX ix_disponibilidad_gui_id ON disponibilidad (gui_id);`;

export class InventoryGuides1796000000510 implements MigrationInterface {
  name = 'InventoryGuides1796000000510';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX ix_disponibilidad_gui_id');
    await queryRunner.query('ALTER TABLE disponibilidad DROP COLUMN gui_id');
    await queryRunner.query('ALTER TABLE horario DROP COLUMN gui_id');
  }
}
