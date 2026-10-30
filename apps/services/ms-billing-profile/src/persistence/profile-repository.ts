import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { DatoFacturacionDto, DatoFacturacionInput, TipoIdentificacion } from '../contract';

interface ProfileRow {
  dfa_id: string;
  usu_id: string;
  dfa_tipo_identificacion: TipoIdentificacion;
  dfa_identificacion: string;
  dfa_razon_social: string;
  dfa_correo: string;
  dfa_telefono: string | null;
  dfa_es_principal: boolean;
  dfa_activo: boolean;
  dfa_creado_en: Date;
}

const COLUMNS = `dfa_id, usu_id, dfa_tipo_identificacion, dfa_identificacion, dfa_razon_social, dfa_correo, dfa_telefono,
  dfa_es_principal, dfa_activo, dfa_creado_en`;

const toDto = (row: ProfileRow): DatoFacturacionDto => ({
  id: Number(row.dfa_id),
  usu_id: Number(row.usu_id),
  tipo_identificacion: row.dfa_tipo_identificacion,
  identificacion: row.dfa_identificacion,
  razon_social: row.dfa_razon_social,
  correo: row.dfa_correo,
  telefono: row.dfa_telefono,
  es_principal: row.dfa_es_principal,
  activo: row.dfa_activo,
  creado_en: row.dfa_creado_en.toISOString(),
});

const notFound = (id: number) => AppError.notFound(`No existe el perfil de facturación ${id}.`, 'BILLING_PROFILE_NOT_FOUND');
const exists = () => AppError.conflict('BILLING_PROFILE_EXISTS', 'Ya tiene un perfil con ese tipo y número de identificación.');

/** Las escrituras de un usuario van de una en una, con un bloqueo por usuario dentro de su transacción. */
export class ProfileRepository {
  constructor(private readonly db: DataSource) {}

  private inUserLock<T>(usuId: number, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [usuId]);
      return work(m);
    });
  }

  async list(usuId: number): Promise<DatoFacturacionDto[]> {
    const rows: ProfileRow[] = await this.db.query(
      `SELECT ${COLUMNS} FROM dato_facturacion WHERE usu_id = $1 AND dfa_activo ORDER BY dfa_es_principal DESC, dfa_creado_en DESC, dfa_id DESC`,
      [usuId],
    );
    return rows.map(toDto);
  }

  async findPrincipal(usuId: number): Promise<DatoFacturacionDto | null> {
    const [row] = await this.db.query(`SELECT ${COLUMNS} FROM dato_facturacion WHERE usu_id = $1 AND dfa_activo AND dfa_es_principal`, [usuId]);
    return row ? toDto(row) : null;
  }

  private async hasPrincipal(usuId: number, m: EntityManager): Promise<boolean> {
    const [row] = await m.query(`SELECT 1 FROM dato_facturacion WHERE usu_id = $1 AND dfa_es_principal`, [usuId]);
    return Boolean(row);
  }

  /** Primero se desmarca el anterior, por `ux_dato_facturacion_principal`. */
  private async clearPrincipal(usuId: number, m: EntityManager): Promise<void> {
    await m.query(`UPDATE dato_facturacion SET dfa_es_principal = FALSE WHERE usu_id = $1 AND dfa_es_principal`, [usuId]);
  }

  /** El primero queda como principal. Un perfil inactivo con el mismo documento se reactiva con los datos nuevos. */
  create(usuId: number, input: DatoFacturacionInput): Promise<DatoFacturacionDto> {
    return this.inUserLock(usuId, async (m) => {
      const [existing] = await m.query(
        `SELECT dfa_id, dfa_activo FROM dato_facturacion WHERE usu_id = $1 AND dfa_tipo_identificacion = $2 AND dfa_identificacion = $3`,
        [usuId, input.tipo_identificacion, input.identificacion],
      );
      if (existing?.dfa_activo) throw exists();
      const principal = input.es_principal || !(await this.hasPrincipal(usuId, m));
      if (principal) await this.clearPrincipal(usuId, m);
      const data = [input.razon_social, input.correo, input.telefono, principal];
      const rows = existing
        ? returnedRows<ProfileRow>(
            await m.query(
              `UPDATE dato_facturacion SET dfa_razon_social = $2, dfa_correo = $3, dfa_telefono = $4, dfa_es_principal = $5, dfa_activo = TRUE
               WHERE dfa_id = $1 RETURNING ${COLUMNS}`,
              [existing.dfa_id, ...data],
            ),
          )
        : await m.query(
            `INSERT INTO dato_facturacion (usu_id, dfa_tipo_identificacion, dfa_identificacion, dfa_razon_social, dfa_correo, dfa_telefono, dfa_es_principal)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
            [usuId, input.tipo_identificacion, input.identificacion, ...data],
          );
      return toDto(rows[0]);
    });
  }

  /** `es_principal: false` no quita el principal: un usuario con perfiles activos siempre tiene uno. */
  replace(usuId: number, id: number, input: DatoFacturacionInput): Promise<DatoFacturacionDto> {
    return this.inUserLock(usuId, async (m) => {
      await this.requireActive(usuId, id, m);
      if (input.es_principal) await this.clearPrincipal(usuId, m);
      try {
        const rows = returnedRows<ProfileRow>(
          await m.query(
            `UPDATE dato_facturacion SET dfa_tipo_identificacion = $2, dfa_identificacion = $3, dfa_razon_social = $4, dfa_correo = $5,
               dfa_telefono = $6, dfa_es_principal = dfa_es_principal OR $7
             WHERE dfa_id = $1 RETURNING ${COLUMNS}`,
            [id, input.tipo_identificacion, input.identificacion, input.razon_social, input.correo, input.telefono, input.es_principal],
          ),
        );
        return toDto(rows[0]);
      } catch (error) {
        const driver = (error as { driverError?: { code?: string } }).driverError;
        throw driver?.code === '23505' ? exists() : error;
      }
    });
  }

  /** Borrado lógico. Si era el principal, el activo más reciente pasa a serlo. */
  deactivate(usuId: number, id: number): Promise<void> {
    return this.inUserLock(usuId, async (m) => {
      const current = await this.requireActive(usuId, id, m);
      await m.query(`UPDATE dato_facturacion SET dfa_activo = FALSE, dfa_es_principal = FALSE WHERE dfa_id = $1`, [id]);
      if (!current.dfa_es_principal) return;
      await m.query(
        `UPDATE dato_facturacion SET dfa_es_principal = TRUE
         WHERE dfa_id = (SELECT dfa_id FROM dato_facturacion WHERE usu_id = $1 AND dfa_activo ORDER BY dfa_creado_en DESC, dfa_id DESC LIMIT 1)`,
        [usuId],
      );
    });
  }

  markPrincipal(usuId: number, id: number): Promise<DatoFacturacionDto> {
    return this.inUserLock(usuId, async (m) => {
      await this.requireActive(usuId, id, m);
      await this.clearPrincipal(usuId, m);
      const rows = returnedRows<ProfileRow>(await m.query(`UPDATE dato_facturacion SET dfa_es_principal = TRUE WHERE dfa_id = $1 RETURNING ${COLUMNS}`, [id]));
      return toDto(rows[0]);
    });
  }

  /** El perfil de otro usuario responde igual que uno inexistente. */
  private async requireActive(usuId: number, id: number, m: EntityManager): Promise<ProfileRow> {
    const [row] = await m.query(`SELECT ${COLUMNS} FROM dato_facturacion WHERE dfa_id = $1 AND usu_id = $2 AND dfa_activo`, [id, usuId]);
    if (!row) throw notFound(id);
    return row;
  }
}
