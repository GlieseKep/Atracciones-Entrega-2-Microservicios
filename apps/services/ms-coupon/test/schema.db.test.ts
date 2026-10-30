import type { DataSource } from 'typeorm';
import { freshDatabase, pgError, type TestDatabase } from './database';

const CHECK = '23514';
const UNIQUE = '23505';
const NOT_NULL = '23502';

describe('esquema de ms_coupon', () => {
  let db: TestDatabase;
  let ds: DataSource;

  beforeAll(async () => {
    db = await freshDatabase();
    ds = db.dataSource;
  });
  afterAll(() => db.drop());

  const coupon = (values: Record<string, unknown> = {}) => {
    const row = { cup_codigo: 'BIENVENIDA10', cup_tipo: 'PORCENTAJE', cup_valor: 10, cup_fecha_inicio: '2026-11-01', ...values };
    const names = Object.keys(row);
    return ds.query(`INSERT INTO cupon (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
  };
  const agreement = (values: Record<string, unknown>) => {
    const row = { apr_proveedor_codigo: 'otro-proveedor', apr_permite_promociones: true, apr_vigencia_hasta: '2027-12-31', ...values };
    const names = Object.keys(row);
    return ds.query(`INSERT INTO acuerdo_promocion (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
  };

  it('tiene las tablas del diseño', async () => {
    const rows: { table_name: string }[] = await ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(['acuerdo_promocion', 'acuerdo_promocion_destino', 'cupon']);
  });

  it('carga el acuerdo inicial: sin promociones y vigente un año', async () => {
    const [row] = await ds.query(
      `SELECT apr_proveedor_codigo, apr_permite_promociones, apr_porcentaje_descuento_max::float8 AS pct,
              apr_vigencia_hasta = (CURRENT_DATE + INTERVAL '1 year')::date AS un_anio FROM acuerdo_promocion`,
    );
    expect(row).toEqual({ apr_proveedor_codigo: 'proveedor-atracciones-dilan', apr_permite_promociones: false, pct: 0, un_anio: true });
  });

  it('cupón: código en mayúsculas, único, tipo, porcentaje, vigencia y usos', async () => {
    await coupon();
    expect(await pgError(coupon())).toBe(UNIQUE);
    expect(await pgError(coupon({ cup_codigo: 'minusculas' }))).toBe(CHECK);
    expect(await pgError(coupon({ cup_codigo: 'C2', cup_tipo: 'MONTO' }))).toBe(CHECK);
    expect(await pgError(coupon({ cup_codigo: 'C3', cup_valor: 101 }))).toBe(CHECK);
    expect(await pgError(coupon({ cup_codigo: 'C4', cup_valor: -1 }))).toBe(CHECK);
    expect(await pgError(coupon({ cup_codigo: 'C5', cup_fecha_fin: '2026-10-31' }))).toBe(CHECK);
    expect(await pgError(coupon({ cup_codigo: 'C6', cup_usos_max: 0 }))).toBe(CHECK);
    await expect(coupon({ cup_codigo: 'FIJO150', cup_tipo: 'FIJO', cup_valor: 150 })).resolves.toBeDefined();
  });

  it('acuerdo: vigencia obligatoria y coherente, porcentaje 0-50, contacto válido', async () => {
    expect(await pgError(agreement({ apr_vigencia_hasta: null }))).toBe(NOT_NULL);
    expect(await pgError(agreement({ apr_porcentaje_descuento_max: 50.01 }))).toBe(CHECK);
    expect(await pgError(agreement({ apr_fecha_acuerdo: '2027-01-01', apr_vigencia_hasta: '2026-12-31' }))).toBe(CHECK);
    expect(await pgError(agreement({ apr_contacto_correo: 'no-es-correo' }))).toBe(CHECK);
    expect(await pgError(agreement({ apr_contacto_telefono: '12' }))).toBe(CHECK);
    expect(await pgError(agreement({ apr_proveedor_codigo: 'proveedor-atracciones-dilan' }))).toBe(UNIQUE);
  });

  it('los destinos se borran con su acuerdo y no se repiten', async () => {
    const [{ apr_id }] = await ds.query(`INSERT INTO acuerdo_promocion (apr_proveedor_codigo, apr_permite_promociones, apr_vigencia_hasta)
      VALUES ('con-destinos', TRUE, '2027-12-31') RETURNING apr_id`);
    await ds.query(`INSERT INTO acuerdo_promocion_destino (apr_id, ciu_id) VALUES ($1, 1), ($1, 2)`, [apr_id]);
    expect(await pgError(ds.query(`INSERT INTO acuerdo_promocion_destino (apr_id, ciu_id) VALUES ($1, 1)`, [apr_id]))).toBe(UNIQUE);
    await ds.query(`DELETE FROM acuerdo_promocion WHERE apr_id = $1`, [apr_id]);
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM acuerdo_promocion_destino WHERE apr_id = $1`, [apr_id]);
    expect(n).toBe(0);
  });

  it('las migraciones se revierten por completo', async () => {
    const other = await freshDatabase();
    try {
      await other.dataSource.undoLastMigration({ transaction: 'each' });
      await other.dataSource.undoLastMigration({ transaction: 'each' });
      const [{ n }] = await other.dataSource.query(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'`,
      );
      expect(n).toBe(0);
    } finally {
      await other.drop();
    }
  });
});
