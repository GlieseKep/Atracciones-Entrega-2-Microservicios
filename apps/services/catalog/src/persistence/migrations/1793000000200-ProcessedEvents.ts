import { eventoProcesadoDdl } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Deduplicación de los eventos que consume Catalog (p. ej. `ReservaEmitida` para la popularidad). */
export class ProcessedEvents1793000000200 implements MigrationInterface {
  name = 'ProcessedEvents1793000000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of eventoProcesadoDdl()) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE evento_procesado');
  }
}
