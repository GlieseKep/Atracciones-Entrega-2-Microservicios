/** Utilidades para escribir el DDL de las migraciones a partir de los valores del contrato. */

/** `('A', 'B')` para `CHECK (columna IN …)`. Solo para constantes del código, nunca para datos de usuario. */
export const sqlList = (values: readonly string[]) => `(${values.map(literal).join(', ')})`;

/** `ARRAY['A', 'B']::varchar[]`. Solo para constantes del código, nunca para datos de usuario. */
export const sqlArray = (values: readonly string[]) => `ARRAY[${values.map(literal).join(', ')}]::varchar[]`;

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Filas de un `UPDATE … RETURNING` o `DELETE … RETURNING`: con PostgreSQL, `DataSource.query` devuelve
 * `[filas, cantidad]` para esas sentencias (y solo las filas para `SELECT` e `INSERT`).
 */
export function returnedRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') return result[0] as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * Tabla `outbox` del patrón Transactional Outbox (igual en todos los servicios que publican eventos).
 * `schema` permite crearla dentro de un esquema propio (Inventory usa `schema_atracciones`).
 */
export function outboxDdl(schema?: string): string[] {
  const t = schema ? `${schema}.outbox` : 'outbox';
  return [
    `CREATE TABLE ${t} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL CONSTRAINT uq_outbox_event_id UNIQUE,
      tipo_evento varchar(60) NOT NULL,
      agregado_id varchar(60) NOT NULL,
      payload jsonb NOT NULL,
      correlation_id varchar(100) NOT NULL,
      creado_en timestamptz NOT NULL DEFAULT now(),
      publicado_en timestamptz,
      intentos int NOT NULL DEFAULT 0 CONSTRAINT ck_outbox_intentos CHECK (intentos >= 0),
      ultimo_error varchar(500)
    )`,
    `CREATE INDEX ix_outbox_pendientes ON ${t} (creado_en) WHERE publicado_en IS NULL`,
  ];
}

/** Tabla `evento_procesado`: eventos del bus ya aplicados por un consumidor (deduplicación por `event_id`). */
export function eventoProcesadoDdl(): string[] {
  return [
    `CREATE TABLE evento_procesado (
      event_id uuid NOT NULL,
      consumidor varchar(60) NOT NULL,
      procesado_en timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT pk_evento_procesado PRIMARY KEY (event_id, consumidor)
    )`,
  ];
}

/** Tabla `idempotencia`: respuestas guardadas por `Idempotency-Key` (retención de 24 h). */
export function idempotenciaDdl(): string[] {
  return [
    `CREATE TABLE idempotencia (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      principal_tipo varchar(12) NOT NULL CONSTRAINT ck_idempotencia_principal_tipo CHECK (principal_tipo IN ('USUARIO', 'API_CLIENTE')),
      principal_id uuid NOT NULL,
      operacion varchar(60) NOT NULL,
      clave uuid NOT NULL,
      hash_solicitud char(64) NOT NULL,
      status_http smallint CONSTRAINT ck_idempotencia_status CHECK (status_http BETWEEN 100 AND 599),
      cuerpo_respuesta jsonb,
      creado_en timestamptz NOT NULL DEFAULT now(),
      completado_en timestamptz,
      expira_en timestamptz NOT NULL,
      CONSTRAINT uq_idempotencia_identidad UNIQUE (principal_tipo, principal_id, operacion, clave),
      CONSTRAINT ck_idempotencia_completada CHECK ((completado_en IS NULL) = (status_http IS NULL))
    )`,
    `CREATE INDEX ix_idempotencia_expira_en ON idempotencia (expira_en)`,
  ];
}
