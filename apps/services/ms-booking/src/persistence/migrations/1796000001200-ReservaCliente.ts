import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turista de la reserva (`cliente_api` de Identity, solo en compras de un socio) y aviso del check-in a Booking Central.
 * El aviso se escribe en la misma transacción que el check-in y se reintenta hasta que Booking lo confirme.
 */
const UP = String.raw`ALTER TABLE reserva ADD COLUMN cla_id_cliente BIGINT;   -- ID logico (Identity, cliente_api TURISTA); NULL en compras web
-- Quien compró: el portal (usuario web) o un socio con X-API-Key. Solo las de un socio se avisan a Booking Central.
ALTER TABLE reserva ADD COLUMN res_canal VARCHAR(10) NOT NULL DEFAULT 'WEB'
    CONSTRAINT reserva_canal_valido CHECK (res_canal IN ('WEB', 'SOCIO'));
UPDATE reserva SET res_canal = 'SOCIO' WHERE res_saga_id IS NOT NULL;
CREATE INDEX ix_reserva_cla_id_cliente ON reserva (cla_id_cliente);

CREATE TABLE notificacion_checkin (
    res_id            BIGINT       PRIMARY KEY
        CONSTRAINT fk_notificacion_checkin_reserva REFERENCES reserva (res_id) ON DELETE CASCADE,
    nch_payload       JSONB        NOT NULL,             -- cuerpo de POST /api/v3/reservas/{external_order_id}/checkin
    nch_intentos      INTEGER      NOT NULL DEFAULT 0,
    nch_ultimo_error  VARCHAR(500),
    nch_proximo_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    nch_enviado_en    TIMESTAMPTZ,
    nch_creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT notificacion_checkin_intentos_validos CHECK (nch_intentos >= 0)
);
CREATE INDEX ix_notificacion_checkin_pendiente ON notificacion_checkin (nch_proximo_en) WHERE nch_enviado_en IS NULL;`;

const DOWN = [
  'DROP TABLE notificacion_checkin',
  'DROP INDEX ix_reserva_cla_id_cliente',
  'ALTER TABLE reserva DROP COLUMN res_canal',
  'ALTER TABLE reserva DROP COLUMN cla_id_cliente',
];

export class ReservaCliente1796000001200 implements MigrationInterface {
  name = 'ReservaCliente1796000001200';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of DOWN) await queryRunner.query(sentence);
  }
}
