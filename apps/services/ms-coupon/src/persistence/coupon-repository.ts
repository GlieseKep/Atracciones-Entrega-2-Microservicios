import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { CouponCreate, CouponFilters, CouponPatch } from '../application/coupon-input';
import type { CouponDto } from '../contract';

/** Columnas con los nombres del esquema `Coupon` del contrato (fechas como texto: sin corrimientos de zona horaria). */
const COLUMNS = `cup_codigo AS code, cup_tipo AS type, cup_valor::float8 AS value, cup_fecha_inicio::text AS start_date,
  cup_fecha_fin::text AS end_date, cup_usos_max AS max_uses, cup_activo AS active`;

const isUniqueViolation = (error: unknown) => (error as { driverError?: { code?: string } }).driverError?.code === '23505';

/** Cupones de descuento. Los usos no se guardan aquí: los cuenta Order en `orden_cupon`. */
export class CouponRepository {
  constructor(private readonly db: DataSource) {}

  async list(filters: CouponFilters): Promise<{ total: number; items: CouponDto[] }> {
    const where = `($1::boolean IS NULL OR cup_activo = $1) AND ($2::varchar IS NULL OR position(upper($2) IN cup_codigo) > 0)`;
    const params = [filters.active, filters.code];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM cupon WHERE ${where}`, params);
    const items: CouponDto[] = await this.db.query(
      `SELECT ${COLUMNS} FROM cupon WHERE ${where} ORDER BY cup_codigo LIMIT $3 OFFSET $4`,
      [...params, filters.limit, (filters.page - 1) * filters.limit],
    );
    return { total, items };
  }

  async get(code: string): Promise<CouponDto | null> {
    const [row] = await this.db.query(`SELECT ${COLUMNS} FROM cupon WHERE cup_codigo = $1`, [code]);
    return row ?? null;
  }

  async create(c: CouponCreate): Promise<CouponDto> {
    try {
      const [row] = await this.db.query(
        `INSERT INTO cupon (cup_codigo, cup_tipo, cup_valor, cup_fecha_inicio, cup_fecha_fin, cup_usos_max, cup_activo)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [c.code, c.type, c.value, c.startDate, c.endDate, c.maxUses, c.active],
      );
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('COUPON_CODE_EXISTS', `Ya existe un cupón con el código ${c.code}.`);
      throw error;
    }
  }

  /** Aplica los cambios con el cupón bloqueado; `check` valida el resultado combinado antes de guardarlo. */
  async update(code: string, patch: CouponPatch, check: (merged: CouponDto) => void): Promise<CouponDto | null> {
    return this.db.transaction(async (m) => {
      const [current]: CouponDto[] = await m.query(`SELECT ${COLUMNS} FROM cupon WHERE cup_codigo = $1 FOR UPDATE`, [code]);
      if (!current) return null;
      const merged: CouponDto = {
        ...current,
        start_date: patch.startDate ?? current.start_date,
        end_date: patch.endDate !== undefined ? patch.endDate : current.end_date,
        max_uses: patch.maxUses !== undefined ? patch.maxUses : current.max_uses,
        active: patch.active ?? current.active,
      };
      check(merged);
      const [row] = returnedRows<CouponDto>(await m.query(
        `UPDATE cupon SET cup_fecha_inicio = $2, cup_fecha_fin = $3, cup_usos_max = $4, cup_activo = $5 WHERE cup_codigo = $1 RETURNING ${COLUMNS}`,
        [code, merged.start_date, merged.end_date, merged.max_uses, merged.active],
      ));
      return row;
    });
  }
}
