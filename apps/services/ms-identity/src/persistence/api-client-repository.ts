import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { ClienteApiDto } from '../contract';

interface ClienteApiRow {
  cla_id: string;
  cla_codigo: string;
  cla_nombre: string;
  cla_activo: boolean;
  cla_creado_en: Date;
  cla_ultimo_uso: Date | null;
}

const COLUMNS = 'cla_id, cla_codigo, cla_nombre, cla_activo, cla_creado_en, cla_ultimo_uso';

const toDto = (row: ClienteApiRow): ClienteApiDto => ({
  id: Number(row.cla_id),
  codigo: row.cla_codigo,
  nombre: row.cla_nombre,
  activo: row.cla_activo,
  creado_en: row.cla_creado_en.toISOString(),
  ultimo_uso: row.cla_ultimo_uso?.toISOString() ?? null,
});

export class ApiClientRepository {
  constructor(private readonly db: DataSource) {}

  async create(codigo: string, nombre: string, keyHash: string): Promise<ClienteApiDto> {
    try {
      const [row] = await this.db.query(
        `INSERT INTO cliente_api (cla_codigo, cla_nombre, cla_clave_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
        [codigo, nombre, keyHash],
      );
      return toDto(row);
    } catch (error) {
      const e = error as { driverError?: { code?: string; constraint?: string } };
      if (e.driverError?.code === '23505' && e.driverError.constraint === 'cliente_api_cla_codigo_key') {
        throw AppError.conflict('CLIENT_CODE_EXISTS', `Ya existe un cliente API con el código ${codigo}.`);
      }
      throw error;
    }
  }

  async list(): Promise<ClienteApiDto[]> {
    const rows: ClienteApiRow[] = await this.db.query(`SELECT ${COLUMNS} FROM cliente_api ORDER BY cla_creado_en DESC, cla_id DESC`);
    return rows.map(toDto);
  }

  async setActive(id: number, activo: boolean): Promise<ClienteApiDto | null> {
    const rows = returnedRows<ClienteApiRow>(
      await this.db.query(`UPDATE cliente_api SET cla_activo = $2 WHERE cla_id = $1 RETURNING ${COLUMNS}`, [id, activo]),
    );
    return rows.length > 0 ? toDto(rows[0]) : null;
  }

  /** Busca una clave activa por su hash y registra el uso. */
  async useKey(keyHash: string): Promise<ClienteApiDto | null> {
    const rows = returnedRows<ClienteApiRow>(
      await this.db.query(`UPDATE cliente_api SET cla_ultimo_uso = now() WHERE cla_clave_hash = $1 AND cla_activo RETURNING ${COLUMNS}`, [keyHash]),
    );
    return rows.length > 0 ? toDto(rows[0]) : null;
  }
}
