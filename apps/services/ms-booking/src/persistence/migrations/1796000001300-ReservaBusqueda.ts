import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Búsqueda de reservas por documento y correo del titular, y correlación del aviso del check-in para que sus reintentos
 * se puedan seguir en los logs (`Plan/PLAN_REQUISITOS_DEFENSA.md`). DDL de `Plan/ms_booking/ms_booking.sql`.
 */
const UP = [
  'CREATE INDEX ix_reserva_pasajero_documento ON reserva_pasajero (pax_documento)',
  'CREATE INDEX ix_reserva_pasajero_correo ON reserva_pasajero (lower(pax_correo))',
  'ALTER TABLE notificacion_checkin ADD COLUMN nch_correlation_id VARCHAR(100)',
];

const DOWN = [
  'ALTER TABLE notificacion_checkin DROP COLUMN nch_correlation_id',
  'DROP INDEX ix_reserva_pasajero_correo',
  'DROP INDEX ix_reserva_pasajero_documento',
];

export class ReservaBusqueda1796000001300 implements MigrationInterface {
  name = 'ReservaBusqueda1796000001300';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of UP) await queryRunner.query(sentence);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of DOWN) await queryRunner.query(sentence);
  }
}
