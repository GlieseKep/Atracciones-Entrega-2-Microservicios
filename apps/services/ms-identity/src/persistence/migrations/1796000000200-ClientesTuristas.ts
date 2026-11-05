import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turistas que registra un socio (Booking) en `cliente_api`, sin clave ni cuenta web, y el rol `GUIA` para el check-in.
 * DDL de `Plan/ms_identity/ms_identity.sql` (sección "Clientes turistas").
 */
const UP = String.raw`ALTER TABLE cliente_api ADD COLUMN cla_tipo VARCHAR(10) NOT NULL DEFAULT 'SOCIO'
    CONSTRAINT cliente_api_tipo_valido CHECK (cla_tipo IN ('SOCIO', 'TURISTA'));
ALTER TABLE cliente_api ALTER COLUMN cla_clave_hash DROP NOT NULL;
ALTER TABLE cliente_api
    ADD COLUMN cla_correo         dom_correo,
    ADD COLUMN cla_identificacion VARCHAR(20),
    ADD COLUMN cla_telefono       dom_telefono,
    ADD COLUMN cla_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE cliente_api ADD CONSTRAINT cliente_api_datos_por_tipo CHECK (
    (cla_tipo = 'SOCIO'   AND cla_clave_hash IS NOT NULL) OR
    (cla_tipo = 'TURISTA' AND cla_clave_hash IS NULL
                          AND cla_correo IS NOT NULL AND cla_identificacion IS NOT NULL
                          AND (cla_identificacion ~ '^[0-9]{10}$' OR cla_identificacion ~ '^[A-Z0-9]{6,9}$'))
);
CREATE UNIQUE INDEX ux_cliente_api_turista_correo ON cliente_api (lower(cla_correo)) WHERE cla_tipo = 'TURISTA';
CREATE UNIQUE INDEX ux_cliente_api_turista_identificacion ON cliente_api (cla_identificacion) WHERE cla_tipo = 'TURISTA';
CREATE TRIGGER trg_cliente_api_actualizado BEFORE UPDATE ON cliente_api
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('cla_actualizado_en');
INSERT INTO rol (rol_nombre, rol_descripcion)
    VALUES ('GUIA', 'Guía que valida el check-in en el punto de encuentro');`;

const DOWN = [
  `DELETE FROM rol WHERE rol_nombre = 'GUIA'`,
  'DROP TRIGGER trg_cliente_api_actualizado ON cliente_api',
  'DROP INDEX ux_cliente_api_turista_identificacion',
  'DROP INDEX ux_cliente_api_turista_correo',
  `DELETE FROM cliente_api WHERE cla_tipo = 'TURISTA'`,
  'ALTER TABLE cliente_api DROP CONSTRAINT cliente_api_datos_por_tipo',
  'ALTER TABLE cliente_api DROP COLUMN cla_actualizado_en, DROP COLUMN cla_telefono, DROP COLUMN cla_identificacion, DROP COLUMN cla_correo',
  'ALTER TABLE cliente_api ALTER COLUMN cla_clave_hash SET NOT NULL',
  'ALTER TABLE cliente_api DROP COLUMN cla_tipo',
];

export class ClientesTuristas1796000000200 implements MigrationInterface {
  name = 'ClientesTuristas1796000000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of DOWN) await queryRunner.query(sentence);
  }
}
