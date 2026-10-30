import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../problem-details';
import type { Principal } from '../principal';

/** JSON con claves ordenadas: dos payloads equivalentes producen el mismo hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export const payloadHash = (payload: unknown) => createHash('sha256').update(canonicalJson(payload)).digest('hex').toUpperCase();

export interface StoredResponse<T = unknown> {
  status: number;
  body: T;
}

/** Resultado de `begin`: una respuesta guardada para repetir, o el registro nuevo que hay que completar. */
export type IdempotencyStart<T> = { replay: StoredResponse<T> } | { recordId: string };

/** Una solicitud "en proceso" más antigua que esto se considera abandonada (el proceso que la atendía cayó). */
const STALE_IN_PROGRESS_MS = 2 * 60_000;

/**
 * Idempotencia por `Idempotency-Key` sobre la tabla `idempotencia` (plan §5.1, paso 2):
 * - misma clave y mismo cuerpo ya completada → se repite el estado HTTP y el cuerpo guardados (201 o 409 idénticos);
 * - misma clave con otro cuerpo → 409 `IDEMPOTENCY_KEY_REUSED`;
 * - misma clave todavía en proceso → 409 `IDEMPOTENCY_IN_PROGRESS`.
 * La identidad es principal + operación + clave; las claves vencen a las 24 h.
 */
export class IdempotencyStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly retentionHours = 24,
  ) {}

  async begin<T>(principal: Principal, operation: string, key: string, payload: unknown): Promise<IdempotencyStart<T>> {
    const hash = payloadHash(payload);
    return this.dataSource.transaction(async (m) => {
      const [existing] = await m.query(
        `SELECT id, hash_solicitud, status_http, cuerpo_respuesta, creado_en, completado_en, expira_en
           FROM idempotencia
          WHERE principal_tipo = $1 AND principal_id = $2 AND operacion = $3 AND clave = $4
          FOR UPDATE`,
        [principal.tipo, principal.id, operation, key],
      );
      if (existing) {
        const expired = new Date(existing.expira_en).getTime() <= Date.now();
        const stale = !existing.completado_en && Date.now() - new Date(existing.creado_en).getTime() > STALE_IN_PROGRESS_MS;
        if (!expired && !stale) {
          if (existing.hash_solicitud !== hash) {
            throw AppError.conflict('IDEMPOTENCY_KEY_REUSED', 'La Idempotency-Key ya se utilizó con un cuerpo distinto para esta operación.');
          }
          if (!existing.completado_en) {
            throw AppError.conflict('IDEMPOTENCY_IN_PROGRESS', 'Una solicitud con la misma Idempotency-Key todavía se está procesando.');
          }
          return { replay: { status: existing.status_http, body: existing.cuerpo_respuesta as T } };
        }
        await m.query(`DELETE FROM idempotencia WHERE id = $1`, [existing.id]);
      }
      const [row] = await m.query(
        `INSERT INTO idempotencia (principal_tipo, principal_id, operacion, clave, hash_solicitud, expira_en)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
         ON CONFLICT ON CONSTRAINT uq_idempotencia_identidad DO NOTHING
         RETURNING id`,
        [principal.tipo, principal.id, operation, key, hash, this.retentionHours],
      );
      if (!row) throw AppError.conflict('IDEMPOTENCY_IN_PROGRESS', 'Una solicitud con la misma Idempotency-Key todavía se está procesando.');
      return { recordId: row.id as string };
    });
  }

  /** Guarda la respuesta final (éxito o error de negocio) para repetirla ante reintentos. */
  async complete(recordId: string, response: StoredResponse, manager?: EntityManager): Promise<void> {
    await (manager ?? this.dataSource).query(
      `UPDATE idempotencia SET status_http = $2, cuerpo_respuesta = $3, completado_en = now() WHERE id = $1`,
      [recordId, response.status, JSON.stringify(response.body ?? null)],
    );
  }

  /** Descarta el registro tras un fallo técnico: el cliente puede reintentar con la misma clave. */
  async abandon(recordId: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM idempotencia WHERE id = $1 AND completado_en IS NULL`, [recordId]);
  }

  /** Borra las claves vencidas (tarea periódica). */
  async purgeExpired(): Promise<number> {
    const [, count] = await this.dataSource.query(`DELETE FROM idempotencia WHERE expira_en <= now()`);
    return Number(count ?? 0);
  }
}
