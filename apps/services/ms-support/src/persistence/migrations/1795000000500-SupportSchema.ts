import { sqlList } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { ESTADOS_MENSAJE } from '../../contract';

/** Esquema de ms_support (Plan/ms_support/ms_support.sql): mensajes del formulario de contacto. */
const UP = [
  `CREATE DOMAIN dom_correo AS varchar(160) CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')`,

  // usu_id es el id del principal de Identity (ID lógico, sin FK); NULL si el visitante no tenía sesión.
  `CREATE TABLE mensaje_contacto (
    men_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id varchar(64),
    men_nombre varchar(120) NOT NULL,
    men_correo dom_correo NOT NULL,
    men_asunto varchar(200) NOT NULL,
    men_cuerpo varchar(4000) NOT NULL,
    men_estado varchar(12) NOT NULL DEFAULT 'NUEVO',
    men_correlation_id varchar(100) NOT NULL,
    men_ip varchar(45),
    men_creado_en timestamptz NOT NULL DEFAULT now(),
    men_respondido_en timestamptz,
    CONSTRAINT mensaje_contacto_nombre_valido CHECK (length(btrim(men_nombre)) >= 2),
    CONSTRAINT mensaje_contacto_asunto_valido CHECK (length(btrim(men_asunto)) >= 3),
    CONSTRAINT mensaje_contacto_cuerpo_valido CHECK (length(btrim(men_cuerpo)) >= 10),
    CONSTRAINT mensaje_contacto_estado_valido CHECK (men_estado IN ${sqlList(ESTADOS_MENSAJE)}),
    CONSTRAINT mensaje_contacto_respondido_coherente
      CHECK (men_respondido_en IS NULL OR men_estado IN ('RESPONDIDO', 'CERRADO'))
  )`,
  `CREATE INDEX ix_mensaje_contacto_estado ON mensaje_contacto (men_estado, men_creado_en DESC)`,
  // Límite de envíos: mensajes de un correo en la última hora.
  `CREATE INDEX ix_mensaje_contacto_correo ON mensaje_contacto (men_correo, men_creado_en DESC)`,
  `CREATE INDEX ix_mensaje_contacto_usu_id ON mensaje_contacto (usu_id) WHERE usu_id IS NOT NULL`,
];

const DOWN = [
  'DROP TABLE mensaje_contacto',
  'DROP DOMAIN dom_correo',
];

export class SupportSchema1795000000500 implements MigrationInterface {
  name = 'SupportSchema1795000000500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
