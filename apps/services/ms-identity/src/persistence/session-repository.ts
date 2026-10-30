import { returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { Db } from './user-repository';

export interface NuevaSesion {
  usuId: number;
  tokenHash: string;
  ip: string | null;
  userAgent: string | null;
  expiresInSeconds: number;
}

export class SessionRepository {
  constructor(private readonly db: DataSource) {}

  async create(session: NuevaSesion, db: Db = this.db): Promise<string> {
    const [row] = await db.query(
      `INSERT INTO sesion (usu_id, ses_token_hash, ses_ip, ses_user_agent, ses_expira_en)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5)) RETURNING ses_id`,
      [session.usuId, session.tokenHash, session.ip, session.userAgent, session.expiresInSeconds],
    );
    return row.ses_id;
  }

  /** Sesión del `sid` del JWT: sigue vigente mientras no se revoque. */
  async isActive(sesId: string): Promise<boolean> {
    const [row] = await this.db.query(`SELECT 1 FROM sesion WHERE ses_id = $1 AND NOT ses_revocada`, [sesId]);
    return Boolean(row);
  }

  /** Revoca atómicamente la sesión de un refresh token vigente: de dos usos simultáneos, solo uno obtiene el usuario. */
  async consume(tokenHash: string, db: Db): Promise<number | null> {
    const rows = returnedRows<{ usu_id: string }>(
      await db.query(
        `UPDATE sesion SET ses_revocada = TRUE
         WHERE ses_token_hash = $1 AND NOT ses_revocada AND ses_expira_en > now()
         RETURNING usu_id`,
        [tokenHash],
      ),
    );
    return rows.length > 0 ? Number(rows[0].usu_id) : null;
  }

  async revoke(sesId: string): Promise<void> {
    await this.db.query(`UPDATE sesion SET ses_revocada = TRUE WHERE ses_id = $1`, [sesId]);
  }

  /** Revoca todas las sesiones del usuario, salvo la indicada. */
  async revokeAll(usuId: number, db: Db, exceptSesId: string | null = null): Promise<void> {
    await db.query(
      `UPDATE sesion SET ses_revocada = TRUE
       WHERE usu_id = $1 AND NOT ses_revocada AND ($2::uuid IS NULL OR ses_id <> $2::uuid)`,
      [usuId, exceptSesId],
    );
  }
}
