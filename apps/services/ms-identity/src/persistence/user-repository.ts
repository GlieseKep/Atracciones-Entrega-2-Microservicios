import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { PerfilUpdateRequest, RegistroRequest, RolDto, RolNombre, UsuarioDto, UsuarioResumenDto } from '../contract';

export type Db = DataSource | EntityManager;

interface UsuarioRow {
  usu_id: string;
  usu_correo: string;
  usu_nombre: string;
  usu_apellido: string;
  usu_documento: string | null;
  usu_telefono: string | null;
  usu_fecha_nacimiento: string | null;
  usu_avatar: string | null;
  usu_verificado: boolean;
  usu_activo: boolean;
  usu_ultimo_acceso: Date | null;
  usu_creado_en: Date;
  usu_actualizado_en: Date;
}

/** La columna DATE se lee como texto: convertirla a `Date` la movería de día según la zona horaria. */
const COLUMNS = `usu_id, usu_correo, usu_nombre, usu_apellido, usu_documento, usu_telefono,
  usu_fecha_nacimiento::text AS usu_fecha_nacimiento, usu_avatar, usu_verificado, usu_activo,
  usu_ultimo_acceso, usu_creado_en, usu_actualizado_en`;

const toDto = (row: UsuarioRow, roles: RolNombre[]): UsuarioDto => ({
  id: Number(row.usu_id),
  correo: row.usu_correo,
  nombre: row.usu_nombre,
  apellido: row.usu_apellido,
  documento: row.usu_documento,
  telefono: row.usu_telefono,
  fecha_nacimiento: row.usu_fecha_nacimiento,
  avatar: row.usu_avatar,
  verificado: row.usu_verificado,
  activo: row.usu_activo,
  roles,
  ultimo_acceso: row.usu_ultimo_acceso?.toISOString() ?? null,
  creado_en: row.usu_creado_en.toISOString(),
  actualizado_en: row.usu_actualizado_en.toISOString(),
});

/** Traduce `23505` de `usuario` a los conflictos del contrato. */
function translateUnique(error: unknown): unknown {
  const e = error as { driverError?: { code?: string; constraint?: string }; code?: string; constraint?: string };
  const code = e.driverError?.code ?? e.code;
  const constraint = e.driverError?.constraint ?? e.constraint;
  if (code !== '23505') return error;
  if (constraint === 'usuario_usu_correo_key') return AppError.conflict('EMAIL_ALREADY_EXISTS', 'Ya existe una cuenta con ese correo.');
  if (constraint === 'usuario_usu_documento_key') return AppError.conflict('DOCUMENT_ALREADY_EXISTS', 'Ya existe una cuenta con ese documento.');
  return error;
}

export interface UsuarioCredenciales {
  id: number;
  password: string;
  activo: boolean;
  verificado: boolean;
}

export interface UsuarioFiltros {
  q: string | null;
  rol: RolNombre | null;
  activo: boolean | null;
  page: number;
  limit: number;
}

export class UserRepository {
  constructor(private readonly db: DataSource) {}

  async create(db: Db, input: RegistroRequest, passwordHash: string): Promise<number> {
    try {
      const [row] = await db.query(
        `INSERT INTO usuario (usu_correo, usu_password, usu_nombre, usu_apellido, usu_documento, usu_telefono, usu_fecha_nacimiento)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING usu_id`,
        [input.correo, passwordHash, input.nombre, input.apellido, input.documento, input.telefono, input.fecha_nacimiento],
      );
      return Number(row.usu_id);
    } catch (error) {
      throw translateUnique(error);
    }
  }

  async findById(id: number, db: Db = this.db): Promise<UsuarioDto | null> {
    const [row] = await db.query(`SELECT ${COLUMNS} FROM usuario WHERE usu_id = $1`, [id]);
    return row ? toDto(row, await this.rolesOf(id, db)) : null;
  }

  async credentialsByEmail(correo: string): Promise<UsuarioCredenciales | null> {
    const [row] = await this.db.query(`SELECT usu_id, usu_password, usu_activo, usu_verificado FROM usuario WHERE usu_correo = $1`, [correo]);
    return row ? { id: Number(row.usu_id), password: row.usu_password, activo: row.usu_activo, verificado: row.usu_verificado } : null;
  }

  async credentialsById(id: number): Promise<UsuarioCredenciales | null> {
    const [row] = await this.db.query(`SELECT usu_id, usu_password, usu_activo, usu_verificado FROM usuario WHERE usu_id = $1`, [id]);
    return row ? { id: Number(row.usu_id), password: row.usu_password, activo: row.usu_activo, verificado: row.usu_verificado } : null;
  }

  async touchLastAccess(id: number, db: Db): Promise<void> {
    await db.query(`UPDATE usuario SET usu_ultimo_acceso = now() WHERE usu_id = $1`, [id]);
  }

  async updateProfile(id: number, patch: PerfilUpdateRequest): Promise<UsuarioDto | null> {
    const columns: Record<keyof PerfilUpdateRequest, string> = {
      nombre: 'usu_nombre',
      apellido: 'usu_apellido',
      documento: 'usu_documento',
      telefono: 'usu_telefono',
      fecha_nacimiento: 'usu_fecha_nacimiento',
      avatar: 'usu_avatar',
    };
    const entries = (Object.keys(columns) as (keyof PerfilUpdateRequest)[]).filter((field) => patch[field] !== undefined);
    if (entries.length > 0) {
      const sets = entries.map((field, index) => `${columns[field]} = $${index + 2}`);
      try {
        await this.db.query(`UPDATE usuario SET ${sets.join(', ')} WHERE usu_id = $1`, [id, ...entries.map((field) => patch[field])]);
      } catch (error) {
        throw translateUnique(error);
      }
    }
    return this.findById(id);
  }

  async setPassword(id: number, passwordHash: string, db: Db): Promise<void> {
    await db.query(`UPDATE usuario SET usu_password = $2 WHERE usu_id = $1`, [id, passwordHash]);
  }

  async markVerified(id: number, db: Db): Promise<void> {
    await db.query(`UPDATE usuario SET usu_verificado = TRUE WHERE usu_id = $1`, [id]);
  }

  async setActive(id: number, activo: boolean, db: Db): Promise<boolean> {
    const rows = returnedRows(await db.query(`UPDATE usuario SET usu_activo = $2 WHERE usu_id = $1 RETURNING usu_id`, [id, activo]));
    return rows.length > 0;
  }

  async list(filters: UsuarioFiltros): Promise<{ total: number; items: UsuarioDto[] }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.q) {
      params.push(`%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);
      conditions.push(`(usu_correo ILIKE $${params.length} OR usu_nombre ILIKE $${params.length} OR usu_apellido ILIKE $${params.length})`);
    }
    if (filters.rol) {
      params.push(filters.rol);
      conditions.push(`EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r ON r.rol_id = ur.rol_id
                               WHERE ur.usu_id = usuario.usu_id AND r.rol_nombre = $${params.length})`);
    }
    if (filters.activo !== null) {
      params.push(filters.activo);
      conditions.push(`usu_activo = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM usuario ${where}`, params);
    const rows: UsuarioRow[] = await this.db.query(
      `SELECT ${COLUMNS} FROM usuario ${where} ORDER BY usu_creado_en DESC, usu_id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, filters.limit, (filters.page - 1) * filters.limit],
    );
    const roles = await this.rolesOfMany(rows.map((row) => Number(row.usu_id)));
    return { total, items: rows.map((row) => toDto(row, roles.get(Number(row.usu_id)) ?? [])) };
  }

  async summaries(ids: number[]): Promise<UsuarioResumenDto[]> {
    const rows = await this.db.query(`SELECT usu_id, usu_nombre, usu_apellido, usu_correo, usu_activo FROM usuario WHERE usu_id = ANY($1::bigint[])`, [ids]);
    return rows.map((row: { usu_id: string; usu_nombre: string; usu_apellido: string; usu_correo: string; usu_activo: boolean }) => ({
      id: Number(row.usu_id),
      nombre: row.usu_nombre,
      apellido: row.usu_apellido,
      correo: row.usu_correo,
      activo: row.usu_activo,
    }));
  }

  // Roles ---------------------------------------------------------------------

  async rolesOf(id: number, db: Db = this.db): Promise<RolNombre[]> {
    const rows = await db.query(`SELECT rol_nombre FROM v_usuario_roles WHERE usu_id = $1 ORDER BY rol_id`, [id]);
    return rows.map((row: { rol_nombre: RolNombre }) => row.rol_nombre);
  }

  private async rolesOfMany(ids: number[]): Promise<Map<number, RolNombre[]>> {
    const result = new Map<number, RolNombre[]>();
    if (ids.length === 0) return result;
    const rows = await this.db.query(`SELECT usu_id, rol_nombre FROM v_usuario_roles WHERE usu_id = ANY($1::bigint[]) ORDER BY rol_id`, [ids]);
    for (const row of rows as { usu_id: string; rol_nombre: RolNombre }[]) {
      const id = Number(row.usu_id);
      result.set(id, [...(result.get(id) ?? []), row.rol_nombre]);
    }
    return result;
  }

  async listRoles(): Promise<RolDto[]> {
    const rows = await this.db.query(`SELECT rol_id, rol_nombre, rol_descripcion FROM rol WHERE rol_activo ORDER BY rol_id`);
    return rows.map((row: { rol_id: number; rol_nombre: RolNombre; rol_descripcion: string }) => ({
      id: row.rol_id,
      nombre: row.rol_nombre,
      descripcion: row.rol_descripcion,
    }));
  }

  /** `false` si el usuario ya tenía el rol. */
  async assignRole(usuId: number, rol: RolNombre, assignedBy: number | null, db: Db = this.db): Promise<boolean> {
    const rows = await db.query(
      `INSERT INTO usuario_rol (usu_id, rol_id, usr_asignado_por)
       SELECT $1, rol_id, $3 FROM rol WHERE rol_nombre = $2
       ON CONFLICT ON CONSTRAINT pk_usuario_rol DO NOTHING
       RETURNING usu_id`,
      [usuId, rol, assignedBy],
    );
    return rows.length > 0;
  }

  /** `false` si el usuario no tenía el rol. */
  async removeRole(usuId: number, rol: RolNombre): Promise<boolean> {
    const rows = returnedRows(
      await this.db.query(
        `DELETE FROM usuario_rol WHERE usu_id = $1 AND rol_id = (SELECT rol_id FROM rol WHERE rol_nombre = $2) RETURNING usu_id`,
        [usuId, rol],
      ),
    );
    return rows.length > 0;
  }

  async adminExists(): Promise<boolean> {
    const [row] = await this.db.query(`SELECT 1 FROM usuario_rol ur JOIN rol r ON r.rol_id = ur.rol_id WHERE r.rol_nombre = 'ADMIN' LIMIT 1`);
    return Boolean(row);
  }
}
