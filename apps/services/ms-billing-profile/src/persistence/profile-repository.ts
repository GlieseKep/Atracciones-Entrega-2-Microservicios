import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { ProfileInput } from '../application/profile-input';
import type { BillingProfileDto, TipoIdentificacion } from '../contract';

interface ProfileRow {
  id: string;
  tipo_identificacion: TipoIdentificacion;
  identificacion: string;
  razon_social: string;
  correo: string;
  telefono: string | null;
  direccion: string | null;
  es_principal: boolean;
  activo: boolean;
  creado_en: Date;
  actualizado_en: Date;
}

const COLUMNS = `dfa_id AS id, dfa_tipo_identificacion AS tipo_identificacion, dfa_identificacion AS identificacion,
  dfa_razon_social AS razon_social, dfa_correo AS correo, dfa_telefono AS telefono, dfa_direccion AS direccion,
  dfa_es_principal AS es_principal, dfa_activo AS activo, dfa_creado_en AS creado_en, dfa_actualizado_en AS actualizado_en`;

/** `bigint` llega como texto desde `pg`. */
const toDto = (row: ProfileRow): BillingProfileDto => ({
  ...row,
  id: Number(row.id),
  creado_en: new Date(row.creado_en).toISOString(),
  actualizado_en: new Date(row.actualizado_en).toISOString(),
});

const duplicate = () => AppError.conflict('BILLING_PROFILE_EXISTS', 'Ya tiene un perfil de facturación con ese tipo y número de identificación.');

const isDuplicate = (error: unknown) => {
  const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
  return driver?.code === '23505' && driver.constraint === 'uq_dato_facturacion_usuario_identificacion';
};

/**
 * Perfiles de facturación. Todas las operaciones de un usuario se hacen con su cuenta bloqueada
 * (`pg_advisory_xact_lock`): así dos peticiones simultáneas no dejan dos principales ni ninguno.
 * Las consultas de `/usuarios/me/**` filtran siempre por `usu_id`: el perfil de otro usuario "no existe".
 */
export class ProfileRepository {
  constructor(private readonly db: DataSource) {}

  /** Perfiles activos del usuario: el principal primero, luego los más recientes. */
  async listMine(userId: string): Promise<BillingProfileDto[]> {
    const rows: ProfileRow[] = await this.db.query(
      `SELECT ${COLUMNS} FROM dato_facturacion WHERE usu_id = $1 AND dfa_activo
        ORDER BY dfa_es_principal DESC, dfa_creado_en DESC, dfa_id DESC`,
      [userId],
    );
    return rows.map(toDto);
  }

  /** Perfil por ID, activo o no (uso interno: Order e Invoicing). */
  async get(id: number): Promise<BillingProfileDto | null> {
    const [row]: ProfileRow[] = await this.db.query(`SELECT ${COLUMNS} FROM dato_facturacion WHERE dfa_id = $1`, [id]);
    return row ? toDto(row) : null;
  }

  async principal(userId: string): Promise<BillingProfileDto | null> {
    const [row]: ProfileRow[] = await this.db.query(`SELECT ${COLUMNS} FROM dato_facturacion WHERE usu_id = $1 AND dfa_es_principal`, [userId]);
    return row ? toDto(row) : null;
  }

  /**
   * Crea un perfil. El primero del usuario queda como principal. Si hay uno inactivo con el mismo tipo y número se
   * reactiva con los datos nuevos; si hay uno activo, 409.
   */
  async create(userId: string, input: ProfileInput): Promise<BillingProfileDto> {
    return this.withUser(userId, async (m) => {
      const [existing]: { id: string; activo: boolean }[] = await m.query(
        `SELECT dfa_id AS id, dfa_activo AS activo FROM dato_facturacion
          WHERE usu_id = $1 AND dfa_tipo_identificacion = $2 AND dfa_identificacion = $3`,
        [userId, input.tipo, input.identificacion],
      );
      if (existing?.activo) throw duplicate();
      const [{ activos }] = await m.query(`SELECT count(*)::int AS activos FROM dato_facturacion WHERE usu_id = $1 AND dfa_activo`, [userId]);
      const principal = input.esPrincipal || activos === 0;
      if (principal) await this.clearPrincipal(m, userId);
      if (existing) return this.write(m, Number(existing.id), input, principal);
      const [row]: ProfileRow[] = await m.query(
        `INSERT INTO dato_facturacion (usu_id, dfa_tipo_identificacion, dfa_identificacion, dfa_razon_social, dfa_correo, dfa_telefono,
           dfa_direccion, dfa_es_principal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
        [userId, input.tipo, input.identificacion, input.razonSocial, input.correo, input.telefono, input.direccion, principal],
      );
      return toDto(row);
    });
  }

  /**
   * Reemplaza un perfil activo del usuario; `null` si no existe. `es_principal: true` lo marca como principal;
   * `false` no lo desmarca (siempre debe haber uno: se cambia con `setPrincipal` o al desactivarlo).
   */
  async replace(userId: string, id: number, input: ProfileInput): Promise<BillingProfileDto | null> {
    return this.withUser(userId, async (m) => {
      const current = await this.owned(m, userId, id);
      if (!current) return null;
      const principal = current.es_principal || input.esPrincipal;
      if (principal && !current.es_principal) await this.clearPrincipal(m, userId);
      return this.write(m, id, input, principal);
    });
  }

  /** Borrado lógico. Si era el principal, el activo más reciente pasa a serlo. `false` si no existe. */
  async deactivate(userId: string, id: number): Promise<boolean> {
    return this.withUser(userId, async (m) => {
      const current = await this.owned(m, userId, id);
      if (!current) return false;
      await m.query(`UPDATE dato_facturacion SET dfa_activo = FALSE, dfa_es_principal = FALSE WHERE dfa_id = $1`, [id]);
      if (current.es_principal) {
        await m.query(
          `UPDATE dato_facturacion SET dfa_es_principal = TRUE
            WHERE dfa_id = (SELECT dfa_id FROM dato_facturacion WHERE usu_id = $1 AND dfa_activo
                             ORDER BY dfa_creado_en DESC, dfa_id DESC LIMIT 1)`,
          [userId],
        );
      }
      return true;
    });
  }

  /** Marca un perfil activo como principal y desmarca el anterior; `null` si no existe. */
  async setPrincipal(userId: string, id: number): Promise<BillingProfileDto | null> {
    return this.withUser(userId, async (m) => {
      const current = await this.owned(m, userId, id);
      if (!current) return null;
      if (current.es_principal) return current;
      await this.clearPrincipal(m, userId);
      const [row] = returnedRows<ProfileRow>(await m.query(
        `UPDATE dato_facturacion SET dfa_es_principal = TRUE WHERE dfa_id = $1 RETURNING ${COLUMNS}`,
        [id],
      ));
      return toDto(row);
    });
  }

  /**
   * `PUT /usuarios/me/facturacion` (forma de Identity): guarda el perfil principal. Si el usuario ya tiene un perfil
   * con ese documento (activo o no), ese pasa a ser el principal con los datos nuevos; si no, se reemplazan los datos
   * del principal actual, y si no tiene ninguno se crea.
   */
  async saveLegacy(userId: string, input: ProfileInput): Promise<BillingProfileDto> {
    return this.withUser(userId, async (m) => {
      const [sameDocument]: { id: string }[] = await m.query(
        `SELECT dfa_id AS id FROM dato_facturacion WHERE usu_id = $1 AND dfa_tipo_identificacion = $2 AND dfa_identificacion = $3`,
        [userId, input.tipo, input.identificacion],
      );
      const [principal]: { id: string }[] = await m.query(`SELECT dfa_id AS id FROM dato_facturacion WHERE usu_id = $1 AND dfa_es_principal`, [userId]);
      const target = sameDocument ?? principal;
      if (!target) {
        const [row]: ProfileRow[] = await m.query(
          `INSERT INTO dato_facturacion (usu_id, dfa_tipo_identificacion, dfa_identificacion, dfa_razon_social, dfa_correo, dfa_telefono,
             dfa_direccion, dfa_es_principal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE) RETURNING ${COLUMNS}`,
          [userId, input.tipo, input.identificacion, input.razonSocial, input.correo, input.telefono, input.direccion],
        );
        return toDto(row);
      }
      if (principal && principal.id !== target.id) await this.clearPrincipal(m, userId);
      return this.write(m, Number(target.id), input, true);
    });
  }

  /** Transacción con la cuenta del usuario bloqueada; el 23505 de la clave única se traduce a 409. */
  private async withUser<T>(userId: string, work: (m: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async (m) => {
        await m.query(`SELECT pg_advisory_xact_lock(hashtext('dato_facturacion:' || $1))`, [userId]);
        return work(m);
      });
    } catch (error) {
      if (isDuplicate(error)) throw duplicate();
      throw error;
    }
  }

  private async owned(m: EntityManager, userId: string, id: number): Promise<BillingProfileDto | null> {
    const [row]: ProfileRow[] = await m.query(
      `SELECT ${COLUMNS} FROM dato_facturacion WHERE dfa_id = $1 AND usu_id = $2 AND dfa_activo`,
      [id, userId],
    );
    return row ? toDto(row) : null;
  }

  private async clearPrincipal(m: EntityManager, userId: string): Promise<void> {
    await m.query(`UPDATE dato_facturacion SET dfa_es_principal = FALSE WHERE usu_id = $1 AND dfa_es_principal`, [userId]);
  }

  /** Escribe todos los datos del perfil y lo deja activo. */
  private async write(m: EntityManager, id: number, input: ProfileInput, principal: boolean): Promise<BillingProfileDto> {
    const [row] = returnedRows<ProfileRow>(await m.query(
      `UPDATE dato_facturacion SET dfa_tipo_identificacion = $2, dfa_identificacion = $3, dfa_razon_social = $4, dfa_correo = $5,
              dfa_telefono = $6, dfa_direccion = $7, dfa_es_principal = $8, dfa_activo = TRUE
        WHERE dfa_id = $1 RETURNING ${COLUMNS}`,
      [id, input.tipo, input.identificacion, input.razonSocial, input.correo, input.telefono, input.direccion, principal],
    ));
    return toDto(row);
  }
}
