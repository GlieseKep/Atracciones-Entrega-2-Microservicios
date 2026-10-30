import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { OperadorDto, OperatorCharge } from '../contract';
import { mapUnique } from './sql-errors';

interface OperatorRow {
  ope_id: string;
  ope_codigo: string;
  ope_nombre: string;
  ope_ruc: string | null;
  ope_correo: string | null;
  ope_telefono: string | null;
  ope_direccion: string | null;
  prov_id: number;
  ope_activo: boolean;
}

const COLUMNS = 'ope_id, ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, ope_direccion, prov_id, ope_activo';

const toDto = (row: OperatorRow): OperadorDto => ({
  id: row.ope_codigo,
  nombre_comercial: row.ope_nombre,
  ...(row.ope_ruc ? { ruc: row.ope_ruc } : {}),
  ...(row.ope_telefono ? { telefono_emergencia: row.ope_telefono } : {}),
  ...(row.ope_correo ? { email_soporte: row.ope_correo } : {}),
  direccion: row.ope_direccion,
  prov_id: row.prov_id,
  activo: row.ope_activo,
});

const UNIQUE = {
  operador_ope_codigo_key: () => AppError.conflict('OPERATOR_EXISTS', 'Ya existe un operador con ese código.'),
  operador_ope_ruc_key: () => AppError.conflict('OPERATOR_RUC_EXISTS', 'Ya existe un operador con ese RUC.'),
};

export type OperatorPatch = Partial<{
  ope_nombre: string;
  ope_ruc: string | null;
  ope_correo: string | null;
  ope_telefono: string | null;
  ope_direccion: string | null;
  prov_id: number;
  ope_activo: boolean;
}>;

export interface OperatorCreate {
  codigo: string;
  nombre: string;
  ruc: string | null;
  correo: string | null;
  telefono: string | null;
  direccion: string | null;
  provId: number;
}

export class OperatorRepository {
  constructor(private readonly db: DataSource) {}

  async list(onlyIds: number[] | null): Promise<OperadorDto[]> {
    const rows: OperatorRow[] = await this.db.query(
      `SELECT ${COLUMNS} FROM operador WHERE $1::bigint[] IS NULL OR ope_id = ANY($1::bigint[]) ORDER BY ope_nombre`,
      [onlyIds],
    );
    return rows.map(toDto);
  }

  async idByCode(codigo: string): Promise<number | null> {
    const [row] = await this.db.query(`SELECT ope_id FROM operador WHERE ope_codigo = $1`, [codigo]);
    return row ? Number(row.ope_id) : null;
  }

  async create(input: OperatorCreate): Promise<OperadorDto> {
    const [row] = await mapUnique(
      () =>
        this.db.query(
          `INSERT INTO operador (ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, ope_direccion, prov_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
          [input.codigo, input.nombre, input.ruc, input.correo, input.telefono, input.direccion, input.provId],
        ),
      UNIQUE,
    );
    return toDto(row);
  }

  async update(codigo: string, patch: OperatorPatch): Promise<OperadorDto | null> {
    const columns = Object.keys(patch) as (keyof OperatorPatch)[];
    if (columns.length === 0) {
      const [row] = await this.db.query(`SELECT ${COLUMNS} FROM operador WHERE ope_codigo = $1`, [codigo]);
      return row ? toDto(row) : null;
    }
    const sets = columns.map((column, index) => `${column} = $${index + 2}`);
    const rows = returnedRows<OperatorRow>(
      await mapUnique(
        () => this.db.query(`UPDATE operador SET ${sets.join(', ')} WHERE ope_codigo = $1 RETURNING ${COLUMNS}`, [codigo, ...columns.map((column) => patch[column])]),
        UNIQUE,
      ),
    );
    return rows.length > 0 ? toDto(rows[0]) : null;
  }

  // Usuarios del operador ------------------------------------------------------

  /** Operadores a los que un usuario está vinculado y activo. */
  async operatorIdsOf(usuId: number): Promise<number[]> {
    const rows = await this.db.query(`SELECT ope_id FROM operador_usuario WHERE usu_id = $1 AND opeu_activo`, [usuId]);
    return rows.map((row: { ope_id: string }) => Number(row.ope_id));
  }

  /** `false` si el usuario ya estaba vinculado y activo. Un vínculo inactivo se reactiva. */
  async linkUser(opeId: number, usuId: number, cargo: OperatorCharge): Promise<boolean> {
    const rows = await this.db.query(
      `INSERT INTO operador_usuario (ope_id, usu_id, opeu_cargo) VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT pk_operador_usuario
       DO UPDATE SET opeu_cargo = EXCLUDED.opeu_cargo, opeu_activo = TRUE WHERE NOT operador_usuario.opeu_activo
       RETURNING usu_id`,
      [opeId, usuId, cargo],
    );
    return rows.length > 0;
  }

  async unlinkUser(opeId: number, usuId: number): Promise<boolean> {
    const rows = returnedRows(
      await this.db.query(`UPDATE operador_usuario SET opeu_activo = FALSE WHERE ope_id = $1 AND usu_id = $2 AND opeu_activo RETURNING usu_id`, [opeId, usuId]),
    );
    return rows.length > 0;
  }
}
