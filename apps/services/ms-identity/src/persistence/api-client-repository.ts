import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { ClienteApiDto, ClienteDto, ClienteFiltros, ClienteRequest } from '../contract';

interface ClienteApiRow {
  cla_id: string;
  cla_codigo: string;
  cla_nombre: string;
  cla_activo: boolean;
  cla_creado_en: Date;
  cla_ultimo_uso: Date | null;
}

const COLUMNS = 'cla_id, cla_codigo, cla_nombre, cla_activo, cla_creado_en, cla_ultimo_uso';

interface TuristaRow {
  cla_id: string;
  cla_nombre: string;
  cla_correo: string;
  cla_identificacion: string;
  cla_telefono: string | null;
}

const TURISTA_COLUMNS = 'cla_id, cla_nombre, cla_correo, cla_identificacion, cla_telefono';

const toCliente = (row: TuristaRow): ClienteDto => ({
  client_id: String(row.cla_id),
  nombre: row.cla_nombre,
  email: row.cla_correo,
  identificacion: row.cla_identificacion,
  telefono: row.cla_telefono,
});

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

  async create(codigo: string, nombre: string, keyHash: string, db: DataSource | EntityManager = this.db): Promise<ClienteApiDto> {
    try {
      const [row] = await db.query(
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
    const rows: ClienteApiRow[] = await this.db.query(`SELECT ${COLUMNS} FROM cliente_api WHERE cla_tipo = 'SOCIO' ORDER BY cla_creado_en DESC, cla_id DESC`);
    return rows.map(toDto);
  }

  /** Estado actual de un socio (bloquea la fila dentro de una transacción); `null` si no existe. */
  async activeState(id: number, db: DataSource | EntityManager = this.db): Promise<boolean | null> {
    const [row] = await db.query(`SELECT cla_activo FROM cliente_api WHERE cla_id = $1 AND cla_tipo = 'SOCIO' FOR UPDATE`, [id]);
    return row ? row.cla_activo : null;
  }

  async setActive(id: number, activo: boolean, db: DataSource | EntityManager = this.db): Promise<ClienteApiDto | null> {
    const rows = returnedRows<ClienteApiRow>(
      await db.query(`UPDATE cliente_api SET cla_activo = $2 WHERE cla_id = $1 AND cla_tipo = 'SOCIO' RETURNING ${COLUMNS}`, [id, activo]),
    );
    return rows.length > 0 ? toDto(rows[0]) : null;
  }

  async rename(id: number, nombre: string): Promise<ClienteApiDto | null> {
    const rows = returnedRows<ClienteApiRow>(await this.db.query(`UPDATE cliente_api SET cla_nombre = $2 WHERE cla_id = $1 AND cla_tipo = 'SOCIO' RETURNING ${COLUMNS}`, [id, nombre]));
    return rows.length > 0 ? toDto(rows[0]) : null;
  }

  async setKey(id: number, keyHash: string): Promise<ClienteApiDto | null> {
    const rows = returnedRows<ClienteApiRow>(await this.db.query(`UPDATE cliente_api SET cla_clave_hash = $2 WHERE cla_id = $1 AND cla_tipo = 'SOCIO' RETURNING ${COLUMNS}`, [id, keyHash]));
    return rows.length > 0 ? toDto(rows[0]) : null;
  }

  /** Busca una clave activa por su hash y registra el uso. */
  async useKey(keyHash: string): Promise<ClienteApiDto | null> {
    const rows = returnedRows<ClienteApiRow>(
      await this.db.query(`UPDATE cliente_api SET cla_ultimo_uso = now() WHERE cla_clave_hash = $1 AND cla_tipo = 'SOCIO' AND cla_activo RETURNING ${COLUMNS}`, [keyHash]),
    );
    return rows.length > 0 ? toDto(rows[0]) : null;
  }

  /** Turistas con ese correo o esa identificación (0, 1 o 2 filas distintas). */
  async findTourists(filtros: ClienteFiltros): Promise<ClienteDto[]> {
    const rows: TuristaRow[] = await this.db.query(
      `SELECT ${TURISTA_COLUMNS} FROM cliente_api
        WHERE cla_tipo = 'TURISTA'
          AND (lower(cla_correo) = lower($1) OR cla_identificacion = $2)
        ORDER BY cla_id`,
      [filtros.email, filtros.identificacion],
    );
    return rows.map(toCliente);
  }

  /**
   * Inserta el turista sin clave. `cla_id` lo genera la identidad en el mismo `INSERT ... RETURNING`. Devuelve `null` si
   * otro proceso registró el mismo correo o identificación al mismo tiempo (índices únicos de turistas).
   */
  async createTourist(cliente: ClienteRequest): Promise<ClienteDto | null> {
    try {
      const [row] = await this.db.query(
        `INSERT INTO cliente_api (cla_tipo, cla_codigo, cla_nombre, cla_correo, cla_identificacion, cla_telefono)
         VALUES ('TURISTA', $1, $2, $3, $4, $5) RETURNING ${TURISTA_COLUMNS}`,
        [`TUR-${cliente.identificacion}`, cliente.nombre, cliente.email, cliente.identificacion, cliente.telefono],
      );
      return toCliente(row);
    } catch (error) {
      const e = error as { driverError?: { code?: string } };
      if (e.driverError?.code === '23505') return null;
      throw error;
    }
  }
}
