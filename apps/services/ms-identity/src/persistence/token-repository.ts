import { returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { Db } from './user-repository';

export type TipoToken = 'EMAIL' | 'RECUPERACION';

export class TokenRepository {
  constructor(private readonly db: DataSource) {}

  /** Crea un token e invalida los anteriores del mismo tipo: solo el último enlace enviado sirve. */
  async create(usuId: number, tipo: TipoToken, tokenHash: string, expiresInSeconds: number, db: Db = this.db): Promise<void> {
    await db.query(`UPDATE token_verificacion SET tokv_usado = TRUE WHERE usu_id = $1 AND tokv_tipo = $2 AND NOT tokv_usado`, [usuId, tipo]);
    await db.query(
      `INSERT INTO token_verificacion (usu_id, tokv_token, tokv_tipo, tokv_expira_en)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [usuId, tokenHash, tipo, expiresInSeconds],
    );
  }

  /** Marca el token como usado y devuelve su usuario; `null` si no existe, venció o ya se usó. */
  async consume(tokenHash: string, tipo: TipoToken, db: Db): Promise<number | null> {
    const rows = returnedRows<{ usu_id: string }>(
      await db.query(
        `UPDATE token_verificacion SET tokv_usado = TRUE
         WHERE tokv_token = $1 AND tokv_tipo = $2 AND NOT tokv_usado AND tokv_expira_en > now()
         RETURNING usu_id`,
        [tokenHash, tipo],
      ),
    );
    return rows.length > 0 ? Number(rows[0].usu_id) : null;
  }
}
