import type { MigrationInterface, QueryRunner } from 'typeorm';

/** DDL literal de Plan/ms_identity/ms_identity.sql: dominios, trigger, tablas, vista y roles iniciales. */
const UP = String.raw`CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_documento AS VARCHAR(20)
    CHECK (VALUE ~ '^[0-9]{10}$' OR VALUE ~ '^[A-Z]{1,2}[0-9]{6,9}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE rol (
    rol_id          SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rol_nombre      VARCHAR(30)  NOT NULL UNIQUE,   -- ADMIN, OPERADOR, CLIENTE
    rol_descripcion VARCHAR(200) NOT NULL,
    rol_activo      BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE usuario (
    usu_id         BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_correo     dom_correo    NOT NULL UNIQUE,
    usu_password   VARCHAR(100)  NOT NULL,          -- bcrypt, NUNCA texto plano
    usu_nombre     VARCHAR(120)  NOT NULL,
    usu_apellido   VARCHAR(120)  NOT NULL,
    usu_documento  dom_documento UNIQUE,
    usu_telefono   dom_telefono,
    usu_fecha_nacimiento DATE,
    usu_avatar     VARCHAR(255),
    usu_verificado BOOLEAN       NOT NULL DEFAULT FALSE,
    usu_activo     BOOLEAN       NOT NULL DEFAULT TRUE,
    usu_ultimo_acceso TIMESTAMPTZ,
    usu_creado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    usu_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT usuario_nombres_no_vacios
        CHECK (btrim(usu_nombre) <> '' AND btrim(usu_apellido) <> '')
);

CREATE TABLE usuario_rol (
    usu_id           BIGINT      NOT NULL,
    rol_id           SMALLINT    NOT NULL,
    usr_asignado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    usr_asignado_por BIGINT,                        -- admin que lo asigno
    CONSTRAINT pk_usuario_rol PRIMARY KEY (usu_id, rol_id),
    CONSTRAINT fk_usuario_rol_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_usuario_rol_rol
        FOREIGN KEY (rol_id) REFERENCES rol (rol_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_usuario_rol_asignador
        FOREIGN KEY (usr_asignado_por) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX ix_usuario_rol_rol_id ON usuario_rol (rol_id);
CREATE INDEX ix_usuario_rol_asignado_por ON usuario_rol (usr_asignado_por);

CREATE TABLE sesion (
    ses_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    usu_id          BIGINT       NOT NULL,
    ses_token_hash  VARCHAR(128) NOT NULL UNIQUE,   -- SHA-256, nunca el token
    ses_ip          VARCHAR(45),
    ses_user_agent  VARCHAR(255),
    ses_expira_en   TIMESTAMPTZ  NOT NULL,
    ses_revocada    BOOLEAN      NOT NULL DEFAULT FALSE,
    ses_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_sesion_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_sesion_usu_id ON sesion (usu_id);
CREATE INDEX ix_sesion_expira_en ON sesion (ses_expira_en);

CREATE TABLE token_verificacion (
    tokv_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id         BIGINT       NOT NULL,
    tokv_token     VARCHAR(128) NOT NULL UNIQUE,
    tokv_tipo      VARCHAR(20)  NOT NULL,           -- EMAIL, RECUPERACION
    tokv_expira_en TIMESTAMPTZ  NOT NULL,
    tokv_usado     BOOLEAN      NOT NULL DEFAULT FALSE,
    tokv_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT token_verificacion_tipo_valido
        CHECK (tokv_tipo IN ('EMAIL', 'RECUPERACION')),
    CONSTRAINT fk_token_verificacion_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_token_verificacion_usu_id ON token_verificacion (usu_id);

-- Cliente API (maquina a maquina): sistemas externos como Booking Prototipo
-- que consumen la API con la cabecera X-API-Key. NUNCA se guarda la clave,
-- solo su hash.
CREATE TABLE cliente_api (
    cla_id         BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cla_codigo     VARCHAR(60)  NOT NULL UNIQUE,    -- ej. BOOKING_PROTOTIPO
    cla_nombre     VARCHAR(150) NOT NULL,
    cla_clave_hash VARCHAR(128) NOT NULL UNIQUE,    -- SHA-256 de la X-API-Key
    cla_activo     BOOLEAN      NOT NULL DEFAULT TRUE,
    cla_creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    cla_ultimo_uso TIMESTAMPTZ
);

CREATE TRIGGER trg_usuario_actualizado BEFORE UPDATE ON usuario
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('usu_actualizado_en');

CREATE VIEW v_usuario_roles AS
SELECT u.usu_id, u.usu_correo, u.usu_nombre, u.usu_apellido, r.rol_id, r.rol_nombre
FROM usuario u
JOIN usuario_rol ur ON ur.usu_id = u.usu_id
JOIN rol r          ON r.rol_id  = ur.rol_id
WHERE u.usu_activo AND r.rol_activo;

INSERT INTO rol (rol_nombre, rol_descripcion) VALUES
    ('ADMIN',    'Administrador total del marketplace'),
    ('OPERADOR', 'Empresa que opera atracciones'),
    ('CLIENTE',  'Usuario que compra y reserva');`;

const DOWN = [
  'DROP VIEW v_usuario_roles',
  'DROP TABLE cliente_api',
  'DROP TABLE token_verificacion',
  'DROP TABLE sesion',
  'DROP TABLE usuario_rol',
  'DROP TABLE usuario',
  'DROP TABLE rol',
  'DROP FUNCTION fn_actualizar_timestamp',
  'DROP DOMAIN dom_telefono',
  'DROP DOMAIN dom_documento',
  'DROP DOMAIN dom_correo',
];

export class IdentitySchema1796000000000 implements MigrationInterface {
  name = 'IdentitySchema1796000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const sentence of DOWN) await queryRunner.query(sentence);
  }
}
