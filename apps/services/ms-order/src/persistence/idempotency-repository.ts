import type { DataSource } from 'typeorm';

export interface IdempotencySubject {
  tipo: 'USUARIO' | 'CLIENTE_API';
  id: number;
}

export type Reservation<T> = { state: 'new' } | { state: 'done'; response: T } | { state: 'in_progress' } | { state: 'reused' };

const RETENTION = `now() + interval '24 hours'`;
/** Una solicitud en proceso más antigua que esto se considera abandonada: el proceso que la atendía cayó. */
const STALE_MINUTES = 2;

export class IdempotencyRepository {
  constructor(private readonly db: DataSource) {}

  async reserve<T>(clave: string, subject: IdempotencySubject, operacion: string, hash: string): Promise<Reservation<T>> {
    const rows = await this.db.query(
      `INSERT INTO idempotencia AS i (idem_clave, idem_sujeto_tipo, idem_sujeto, idem_operacion, idem_request_hash, idem_expira_en)
       VALUES ($1, $2, $3, $4, $5, ${RETENTION})
       ON CONFLICT ON CONSTRAINT pk_idempotencia DO UPDATE
         SET idem_estado = 'IN_PROGRESS', idem_request_hash = EXCLUDED.idem_request_hash, idem_response = NULL,
             idem_expira_en = EXCLUDED.idem_expira_en, idem_creado_en = now()
         WHERE i.idem_expira_en < now()
            OR (i.idem_request_hash = EXCLUDED.idem_request_hash
                AND (i.idem_estado = 'FAILED' OR (i.idem_estado = 'IN_PROGRESS' AND i.idem_creado_en < now() - make_interval(mins => ${STALE_MINUTES}))))
       RETURNING idem_clave`,
      [clave, subject.tipo, subject.id, operacion, hash],
    );
    if (rows.length > 0) return { state: 'new' };
    const [row] = await this.db.query(
      `SELECT idem_request_hash, idem_estado, idem_response FROM idempotencia WHERE idem_clave = $1 AND idem_sujeto_tipo = $2 AND idem_sujeto = $3`,
      [clave, subject.tipo, subject.id],
    );
    if (row.idem_request_hash !== hash) return { state: 'reused' };
    return row.idem_estado === 'DONE' ? { state: 'done', response: row.idem_response } : { state: 'in_progress' };
  }

  async complete(clave: string, subject: IdempotencySubject, response: unknown): Promise<void> {
    await this.db.query(
      `UPDATE idempotencia SET idem_estado = 'DONE', idem_response = $4 WHERE idem_clave = $1 AND idem_sujeto_tipo = $2 AND idem_sujeto = $3`,
      [clave, subject.tipo, subject.id, JSON.stringify(response)],
    );
  }

  async fail(clave: string, subject: IdempotencySubject): Promise<void> {
    await this.db.query(`UPDATE idempotencia SET idem_estado = 'FAILED' WHERE idem_clave = $1 AND idem_sujeto_tipo = $2 AND idem_sujeto = $3`, [clave, subject.tipo, subject.id]);
  }

  async purgeExpired(): Promise<void> {
    await this.db.query(`DELETE FROM idempotencia WHERE idem_expira_en < now()`);
  }
}
