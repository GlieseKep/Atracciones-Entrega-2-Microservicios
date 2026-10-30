import { SCOPES, sqlList, TIPOS_DOCUMENTO } from '@atracciones/platform';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema de identity_db (BASE_DE_DATOS_MICROSERVICIOS.md, sección 2). */
const UP = [
  `CREATE TABLE usuario (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(254) NOT NULL,
    password_hash varchar(200) NOT NULL,
    nombre_completo varchar(200) NOT NULL,
    tipo varchar(15) NOT NULL CONSTRAINT ck_usuario_tipo CHECK (tipo IN ('PERSONA', 'PARTNER', 'GUIA', 'ADMIN')),
    estado varchar(15) NOT NULL DEFAULT 'ACTIVO' CONSTRAINT ck_usuario_estado CHECK (estado IN ('ACTIVO', 'BLOQUEADO', 'DESHABILITADO')),
    email_verificado boolean NOT NULL DEFAULT false,
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now()
  )`,
  // El correo es único sin distinguir mayúsculas.
  `CREATE UNIQUE INDEX uq_usuario_email ON usuario (lower(email))`,

  `CREATE TABLE rol (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre varchar(60) NOT NULL CONSTRAINT uq_rol_nombre UNIQUE,
    descripcion varchar(300),
    creado_en timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE rol_scope (
    rol_id uuid NOT NULL CONSTRAINT fk_rol_scope_rol REFERENCES rol (id) ON DELETE CASCADE,
    scope varchar(40) NOT NULL CONSTRAINT ck_rol_scope_scope CHECK (scope IN ${sqlList(SCOPES)}),
    CONSTRAINT pk_rol_scope PRIMARY KEY (rol_id, scope)
  )`,
  `CREATE TABLE usuario_rol (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid NOT NULL CONSTRAINT fk_usuario_rol_usuario REFERENCES usuario (id),
    rol_id uuid NOT NULL CONSTRAINT fk_usuario_rol_rol REFERENCES rol (id),
    asignado_por uuid CONSTRAINT fk_usuario_rol_asignado_por REFERENCES usuario (id),
    motivo varchar(500) NOT NULL,
    asignado_en timestamptz NOT NULL DEFAULT now(),
    revocado_en timestamptz,
    CONSTRAINT ck_usuario_rol_revocado CHECK (revocado_en IS NULL OR revocado_en >= asignado_en)
  )`,
  `CREATE UNIQUE INDEX uq_usuario_rol_vigente ON usuario_rol (usuario_id, rol_id) WHERE revocado_en IS NULL`,

  `CREATE TABLE sesion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid NOT NULL CONSTRAINT fk_sesion_usuario REFERENCES usuario (id) ON DELETE CASCADE,
    refresh_token_hash char(64) NOT NULL CONSTRAINT uq_sesion_refresh_token UNIQUE,
    user_agent varchar(300),
    ip inet,
    creado_en timestamptz NOT NULL DEFAULT now(),
    expira_en timestamptz NOT NULL,
    revocado_en timestamptz,
    CONSTRAINT ck_sesion_expira CHECK (expira_en > creado_en)
  )`,
  `CREATE INDEX ix_sesion_usuario ON sesion (usuario_id)`,

  `CREATE TABLE token_verificacion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid NOT NULL CONSTRAINT fk_token_verificacion_usuario REFERENCES usuario (id) ON DELETE CASCADE,
    tipo varchar(20) NOT NULL CONSTRAINT ck_token_verificacion_tipo CHECK (tipo IN ('VERIFICAR_EMAIL', 'RESTABLECER_CLAVE')),
    token_hash char(64) NOT NULL CONSTRAINT uq_token_verificacion_hash UNIQUE,
    expira_en timestamptz NOT NULL,
    usado_en timestamptz
  )`,

  `CREATE TABLE dato_facturacion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid NOT NULL CONSTRAINT fk_dato_facturacion_usuario REFERENCES usuario (id) ON DELETE CASCADE,
    tipo_documento varchar(10) NOT NULL CONSTRAINT ck_dato_facturacion_tipo_documento CHECK (tipo_documento IN ${sqlList(TIPOS_DOCUMENTO)}),
    numero_documento varchar(13) NOT NULL,
    razon_social varchar(200) NOT NULL,
    email varchar(254) NOT NULL,
    telefono varchar(20),
    direccion varchar(300),
    predeterminado boolean NOT NULL DEFAULT false,
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_dato_facturacion_documento CHECK (
      (tipo_documento = 'CEDULA' AND numero_documento ~ '^[0-9]{10}$')
      OR (tipo_documento = 'RUC' AND numero_documento ~ '^[0-9]{13}$')
      OR (tipo_documento = 'PASAPORTE' AND numero_documento ~ '^[A-Za-z0-9]{6,9}$'))
  )`,
  `CREATE INDEX ix_dato_facturacion_usuario ON dato_facturacion (usuario_id)`,
  `CREATE UNIQUE INDEX uq_dato_facturacion_predeterminado ON dato_facturacion (usuario_id) WHERE predeterminado`,

  `CREATE TABLE api_cliente (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre varchar(100) NOT NULL CONSTRAINT uq_api_cliente_nombre UNIQUE,
    usuario_id uuid NOT NULL CONSTRAINT fk_api_cliente_usuario REFERENCES usuario (id),
    prefijo_clave varchar(12) NOT NULL CONSTRAINT uq_api_cliente_prefijo UNIQUE,
    clave_hash char(64) NOT NULL,
    activo boolean NOT NULL DEFAULT true,
    creado_en timestamptz NOT NULL DEFAULT now(),
    ultimo_uso_en timestamptz,
    revocado_en timestamptz
  )`,
  `CREATE TABLE api_cliente_scope (
    api_cliente_id uuid NOT NULL CONSTRAINT fk_api_cliente_scope_cliente REFERENCES api_cliente (id) ON DELETE CASCADE,
    scope varchar(40) NOT NULL CONSTRAINT ck_api_cliente_scope_scope CHECK (scope IN ${sqlList(SCOPES)}),
    CONSTRAINT pk_api_cliente_scope PRIMARY KEY (api_cliente_id, scope)
  )`,
];

const DOWN = [
  'DROP TABLE api_cliente_scope',
  'DROP TABLE api_cliente',
  'DROP TABLE dato_facturacion',
  'DROP TABLE token_verificacion',
  'DROP TABLE sesion',
  'DROP TABLE usuario_rol',
  'DROP TABLE rol_scope',
  'DROP TABLE rol',
  'DROP TABLE usuario',
];

export class IdentitySchema1793000000000 implements MigrationInterface {
  name = 'IdentitySchema1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN) await queryRunner.query(sql);
  }
}
