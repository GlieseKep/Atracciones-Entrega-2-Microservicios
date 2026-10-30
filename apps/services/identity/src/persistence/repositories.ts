import { returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';

export interface UsuarioRow {
  id: string;
  email: string;
  password_hash: string;
  nombre_completo: string;
  tipo: string;
  estado: string;
}

export interface ApiClienteRow {
  id: string;
  nombre: string;
  clave_hash: string;
  activo: boolean;
  revocado_en: Date | null;
  scopes: string[];
}

/** Usuario con sus roles vigentes, para el perfil y la administración (sin la contraseña). */
export interface ProfileRow {
  id: string;
  email: string;
  nombre_completo: string;
  tipo: string;
  estado: string;
  creado_en: Date;
  actualizado_en: Date;
  roles: string[];
}

export interface BillingRow {
  tipo_documento: string;
  numero_documento: string;
  razon_social: string;
  email: string;
  telefono: string | null;
  direccion: string | null;
  actualizado_en: Date;
}

const PROFILE = `
  SELECT u.id, u.email, u.nombre_completo, u.tipo, u.estado, u.creado_en, u.actualizado_en,
         coalesce(array_agg(r.nombre ORDER BY r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '{}') AS roles
    FROM usuario u
    LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id AND ur.revocado_en IS NULL
    LEFT JOIN rol r ON r.id = ur.rol_id`;

/** Acceso a identity_db con SQL explícito (las tablas las define la migración IdentitySchema). */
export class IdentityRepository {
  constructor(private readonly q: DataSource | EntityManager) {}

  /** Ejecuta el trabajo en una transacción con un repositorio ligado a ella. */
  transaction<T>(work: (repo: IdentityRepository) => Promise<T>): Promise<T> {
    return this.q.transaction((m) => work(new IdentityRepository(m)));
  }

  async findUserByEmail(email: string): Promise<UsuarioRow | null> {
    const [row] = await this.q.query(`SELECT id, email, password_hash, nombre_completo, tipo, estado FROM usuario WHERE lower(email) = lower($1)`, [email]);
    return row ?? null;
  }

  /** Inserta el usuario; devuelve `null` si el correo ya existe. */
  async insertUser(user: { email: string; passwordHash: string; nombre: string; tipo: string }): Promise<string | null> {
    const [row] = await this.q.query(
      `INSERT INTO usuario (email, password_hash, nombre_completo, tipo) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [user.email, user.passwordHash, user.nombre, user.tipo],
    );
    return row?.id ?? null;
  }

  async assignRole(usuarioId: string, rol: string, motivo: string): Promise<void> {
    await this.q.query(
      `INSERT INTO usuario_rol (usuario_id, rol_id, motivo)
       SELECT $1, r.id, $3 FROM rol r WHERE r.nombre = $2
       ON CONFLICT DO NOTHING`,
      [usuarioId, rol, motivo],
    );
  }

  /** Scopes de los roles vigentes del usuario. */
  async scopesOf(usuarioId: string): Promise<string[]> {
    const rows: { scope: string }[] = await this.q.query(
      `SELECT DISTINCT s.scope FROM usuario_rol ur JOIN rol_scope s ON s.rol_id = ur.rol_id
        WHERE ur.usuario_id = $1 AND ur.revocado_en IS NULL ORDER BY s.scope`,
      [usuarioId],
    );
    return rows.map((r) => r.scope);
  }

  async rolesOf(usuarioId: string): Promise<string[]> {
    const rows: { nombre: string }[] = await this.q.query(
      `SELECT r.nombre FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id WHERE ur.usuario_id = $1 AND ur.revocado_en IS NULL ORDER BY r.nombre`,
      [usuarioId],
    );
    return rows.map((r) => r.nombre);
  }

  async findApiClientByPrefix(prefix: string): Promise<ApiClienteRow | null> {
    const [row] = await this.q.query(
      `SELECT c.id, c.nombre, c.clave_hash, c.activo, c.revocado_en,
              coalesce(array_agg(s.scope ORDER BY s.scope) FILTER (WHERE s.scope IS NOT NULL), '{}') AS scopes
         FROM api_cliente c LEFT JOIN api_cliente_scope s ON s.api_cliente_id = c.id
        WHERE c.prefijo_clave = $1
        GROUP BY c.id`,
      [prefix],
    );
    return row ?? null;
  }

  async touchApiClient(id: string): Promise<void> {
    await this.q.query(`UPDATE api_cliente SET ultimo_uso_en = now() WHERE id = $1`, [id]);
  }

  async insertApiClient(client: { nombre: string; usuarioId: string; prefix: string; hash: string; scopes: string[] }): Promise<string> {
    const [row] = await this.q.query(
      `INSERT INTO api_cliente (nombre, usuario_id, prefijo_clave, clave_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
      [client.nombre, client.usuarioId, client.prefix, client.hash],
    );
    await this.q.query(`INSERT INTO api_cliente_scope (api_cliente_id, scope) SELECT $1, unnest($2::varchar[])`, [row.id, client.scopes]);
    return row.id;
  }

  async findUserById(id: string): Promise<ProfileRow | null> {
    const [row] = await this.q.query(`${PROFILE} WHERE u.id = $1 GROUP BY u.id`, [id]);
    return row ?? null;
  }

  async findUsersByIds(ids: string[]): Promise<ProfileRow[]> {
    if (ids.length === 0) return [];
    return this.q.query(`${PROFILE} WHERE u.id = ANY($1::uuid[]) GROUP BY u.id`, [ids]);
  }

  async listUsers(filters: { search: string | null; estado: string | null; rol: string | null; limit: number; offset: number }): Promise<{ total: number; items: ProfileRow[] }> {
    const where = `($1::varchar IS NULL OR lower(u.email) LIKE '%' || lower($1) || '%' OR lower(u.nombre_completo) LIKE '%' || lower($1) || '%')
      AND ($2::varchar IS NULL OR u.estado = $2)
      AND ($3::varchar IS NULL OR EXISTS (SELECT 1 FROM usuario_rol x JOIN rol y ON y.id = x.rol_id WHERE x.usuario_id = u.id AND x.revocado_en IS NULL AND y.nombre = $3))`;
    const params = [filters.search, filters.estado, filters.rol];
    const [{ total }] = await this.q.query(`SELECT count(*)::int AS total FROM usuario u WHERE ${where}`, params);
    const items = await this.q.query(`${PROFILE} WHERE ${where} GROUP BY u.id ORDER BY u.creado_en DESC, u.id LIMIT $4 OFFSET $5`, [...params, filters.limit, filters.offset]);
    return { total, items };
  }

  async updateName(id: string, nombre: string): Promise<void> {
    await this.q.query(`UPDATE usuario SET nombre_completo = $2, actualizado_en = now() WHERE id = $1`, [id, nombre]);
  }

  async setStatus(id: string, estado: string): Promise<boolean> {
    const rows = returnedRows(await this.q.query(`UPDATE usuario SET estado = $2, actualizado_en = now() WHERE id = $1 RETURNING id`, [id, estado]));
    return rows.length > 0;
  }

  /** Asigna un rol con su motivo y quién lo asignó; `false` si el rol no existe. Si ya lo tenía vigente no cambia nada. */
  async grantRole(usuarioId: string, rol: string, motivo: string, asignadoPor: string | null): Promise<boolean> {
    const [exists] = await this.q.query(`SELECT id FROM rol WHERE nombre = $1`, [rol]);
    if (!exists) return false;
    await this.q.query(
      `INSERT INTO usuario_rol (usuario_id, rol_id, motivo, asignado_por) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [usuarioId, exists.id, motivo, asignadoPor],
    );
    return true;
  }

  /** Revoca el rol vigente (queda el historial con `revocado_en`). */
  async revokeRole(usuarioId: string, rol: string): Promise<boolean> {
    const rows = returnedRows(await this.q.query(
      `UPDATE usuario_rol ur SET revocado_en = now() FROM rol r
        WHERE r.id = ur.rol_id AND ur.usuario_id = $1 AND r.nombre = $2 AND ur.revocado_en IS NULL RETURNING ur.id`,
      [usuarioId, rol],
    ));
    return rows.length > 0;
  }

  async roles(): Promise<{ nombre: string; descripcion: string | null; scopes: string[]; usuarios: number }[]> {
    return this.q.query(
      `SELECT r.nombre, r.descripcion,
              coalesce((SELECT array_agg(s.scope ORDER BY s.scope) FROM rol_scope s WHERE s.rol_id = r.id), '{}') AS scopes,
              (SELECT count(*)::int FROM usuario_rol ur WHERE ur.rol_id = r.id AND ur.revocado_en IS NULL) AS usuarios
         FROM rol r ORDER BY r.nombre`,
    );
  }

  async countByStatus(): Promise<{ estado: string; total: number }[]> {
    return this.q.query(`SELECT estado, count(*)::int AS total FROM usuario WHERE tipo <> 'PARTNER' GROUP BY estado ORDER BY estado`);
  }

  async billing(usuarioId: string): Promise<BillingRow | null> {
    const [row] = await this.q.query(
      `SELECT tipo_documento, numero_documento, razon_social, email, telefono, direccion, actualizado_en
         FROM dato_facturacion WHERE usuario_id = $1 AND predeterminado`,
      [usuarioId],
    );
    return row ?? null;
  }

  /** Guarda los datos de facturación predeterminados del usuario (uno por usuario). */
  async saveBilling(usuarioId: string, data: Omit<BillingRow, 'actualizado_en'>): Promise<void> {
    const values = [usuarioId, data.tipo_documento, data.numero_documento, data.razon_social, data.email, data.telefono, data.direccion];
    const updated = returnedRows(await this.q.query(
      `UPDATE dato_facturacion SET tipo_documento = $2, numero_documento = $3, razon_social = $4, email = $5, telefono = $6, direccion = $7, actualizado_en = now()
        WHERE usuario_id = $1 AND predeterminado RETURNING id`,
      values,
    ));
    if (updated.length === 0) {
      await this.q.query(
        `INSERT INTO dato_facturacion (usuario_id, tipo_documento, numero_documento, razon_social, email, telefono, direccion, predeterminado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        values,
      );
    }
  }

  async scopesOfRole(rol: string): Promise<string[]> {
    const rows: { scope: string }[] = await this.q.query(
      `SELECT s.scope FROM rol r JOIN rol_scope s ON s.rol_id = r.id WHERE r.nombre = $1 ORDER BY s.scope`,
      [rol],
    );
    return rows.map((r) => r.scope);
  }
}
