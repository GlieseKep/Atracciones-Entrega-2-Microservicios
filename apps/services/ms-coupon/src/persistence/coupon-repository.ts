import { AppError } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { CouponCreate, CouponDto, CouponPatch, CouponType } from '../contract';

interface CouponRow {
  cup_id: string;
  cup_codigo: string;
  cup_tipo: CouponType;
  cup_valor: string;
  cup_fecha_inicio: string;
  cup_fecha_fin: string | null;
  cup_usos_max: number | null;
  cup_activo: boolean;
}

/** Las columnas DATE se leen como texto: convertirlas a `Date` las movería de día según la zona horaria. */
const COLUMNS = `cup_id, cup_codigo, cup_tipo, cup_valor, cup_fecha_inicio::text AS cup_fecha_inicio, cup_fecha_fin::text AS cup_fecha_fin, cup_usos_max, cup_activo`;

const toDto = (row: CouponRow): CouponDto => ({
  code: row.cup_codigo,
  type: row.cup_tipo,
  value: Number(row.cup_valor),
  start_date: row.cup_fecha_inicio,
  end_date: row.cup_fecha_fin,
  max_uses: row.cup_usos_max,
  active: row.cup_activo,
});

export class CouponRepository {
  constructor(private readonly db: DataSource) {}

  async list(filters: { active: boolean | null; code: string | null }, page: number, limit: number): Promise<{ total: number; items: CouponDto[] }> {
    const where = `WHERE ($1::boolean IS NULL OR cup_activo = $1) AND ($2::text IS NULL OR cup_codigo ILIKE $2)`;
    const params = [filters.active, filters.code ? `%${filters.code.replace(/[\\%_]/g, '\\$&')}%` : null];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM cupon ${where}`, params);
    const rows: CouponRow[] = await this.db.query(`SELECT ${COLUMNS} FROM cupon ${where} ORDER BY cup_codigo LIMIT $3 OFFSET $4`, [...params, limit, (page - 1) * limit]);
    return { total, items: rows.map(toDto) };
  }

  async find(code: string): Promise<{ id: number; coupon: CouponDto } | null> {
    const [row] = await this.db.query(`SELECT ${COLUMNS} FROM cupon WHERE cup_codigo = $1`, [code]);
    return row ? { id: Number(row.cup_id), coupon: toDto(row) } : null;
  }

  async create(input: CouponCreate): Promise<CouponDto> {
    try {
      const [row] = await this.db.query(
        `INSERT INTO cupon (cup_codigo, cup_tipo, cup_valor, cup_fecha_inicio, cup_fecha_fin, cup_usos_max, cup_activo)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [input.code, input.type, input.value, input.start_date, input.end_date, input.max_uses, input.active],
      );
      return toDto(row);
    } catch (error) {
      const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
      if (driver?.code === '23505' && driver.constraint === 'cupon_cup_codigo_key') throw AppError.conflict('COUPON_EXISTS', `Ya existe el cupón ${input.code}.`);
      throw error;
    }
  }

  async update(code: string, patch: CouponPatch): Promise<void> {
    const columns: Record<keyof CouponPatch, string> = { start_date: 'cup_fecha_inicio', end_date: 'cup_fecha_fin', max_uses: 'cup_usos_max', active: 'cup_activo' };
    const fields = Object.keys(patch) as (keyof CouponPatch)[];
    const sets = fields.map((field, index) => `${columns[field]} = $${index + 2}`);
    await this.db.query(`UPDATE cupon SET ${sets.join(', ')} WHERE cup_codigo = $1`, [code, ...fields.map((field) => patch[field])]);
  }
}
