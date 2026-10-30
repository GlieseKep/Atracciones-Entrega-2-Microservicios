import type { DataSource } from 'typeorm';
import { freshDatabase, pgError, type TestDatabase } from './database';

const CHECK = '23514';
const UNIQUE = '23505';
const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

describe('esquema de ms_cart', () => {
  let db: TestDatabase;
  let ds: DataSource;

  beforeAll(async () => {
    db = await freshDatabase();
    ds = db.dataSource;
  });
  afterAll(() => db.drop());

  const cart = async (usuario: string) => (await ds.query(`INSERT INTO carrito (usu_id) VALUES ($1) RETURNING car_id`, [usuario]))[0].car_id as string;
  const item = (carId: string, columns: Record<string, unknown> = {}) => {
    const values = { atr_codigo: 'PRhu4UBTWPBC', dis_slot_codigo: 'slot-20261125-1030', ...columns };
    const names = Object.keys(values);
    return ds.query(
      `INSERT INTO carrito_item (car_id, ${names.join(', ')}) VALUES ($1, ${names.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING cai_id`,
      [carId, ...Object.values(values)],
    );
  };

  it('tiene solo las tablas carrito y carrito_item, sin favoritos', async () => {
    const rows: { table_name: string }[] = await ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(['carrito', 'carrito_item']);
  });

  it('un usuario tiene un solo carrito activo, pero puede tener inactivos', async () => {
    await cart('u-activo');
    expect(await pgError(cart('u-activo'))).toBe(UNIQUE);
    await ds.query(`UPDATE carrito SET car_activo = FALSE WHERE usu_id = 'u-activo'`);
    await expect(cart('u-activo')).resolves.toBeDefined();
  });

  it('no repite atracción + turno pendiente, con turno ni sin turno', async () => {
    const c = await cart('u-duplicado');
    await item(c);
    expect(await pgError(item(c))).toBe(UNIQUE);
    await item(c, { dis_slot_codigo: null });
    expect(await pgError(item(c, { dis_slot_codigo: null }))).toBe(UNIQUE);
    // Otro turno de la misma atracción sí.
    await expect(item(c, { dis_slot_codigo: 'slot-20261126-1030' })).resolves.toBeDefined();
  });

  it('se puede volver a agregar una atracción ya comprada', async () => {
    const c = await cart('u-recompra');
    await item(c, { cai_estado: 'COMPRADO', cai_ord_numero: 'ORD-RECOMPRA', cai_orden_clave: KEY, cai_en_pago_desde: new Date(), cai_comprado_en: new Date() });
    await expect(item(c)).resolves.toBeDefined();
  });

  it('el estado de compra debe ser coherente con la orden y el turno', async () => {
    const c = await cart('u-estado');
    const enPago = { cai_estado: 'EN_PAGO', cai_ord_numero: 'ORD-E1', cai_orden_clave: KEY, cai_en_pago_desde: new Date() };
    expect(await pgError(item(c, { ...enPago, dis_slot_codigo: null }))).toBe(CHECK);
    expect(await pgError(item(c, { ...enPago, cai_ord_numero: null }))).toBe(CHECK);
    expect(await pgError(item(c, { ...enPago, cai_estado: 'COMPRADO' }))).toBe(CHECK);
    expect(await pgError(item(c, { cai_ord_numero: 'ORD-E2' }))).toBe(CHECK);
    expect(await pgError(item(c, { cai_estado: 'PAGADO' }))).toBe(CHECK);
    await expect(item(c, enPago)).resolves.toBeDefined();
  });

  it('una orden corresponde a un solo ítem', async () => {
    const c = await cart('u-orden');
    const enPago = { cai_estado: 'EN_PAGO', cai_ord_numero: 'ORD-UNICA', cai_orden_clave: KEY, cai_en_pago_desde: new Date() };
    await item(c, enPago);
    expect(await pgError(item(c, { ...enPago, atr_codigo: 'BnosAventur1' }))).toBe(UNIQUE);
  });

  it('valida cantidades, ID público y formato del turno', async () => {
    const c = await cart('u-formato');
    expect(await pgError(item(c, { cai_adultos: 0 }))).toBe(CHECK);
    expect(await pgError(item(c, { cai_ninos: -1 }))).toBe(CHECK);
    expect(await pgError(item(c, { atr_codigo: 'PRhu-UBTWPBC' }))).toBe(CHECK);
    expect(await pgError(item(c, { dis_slot_codigo: 'slot-2026-11-25-1030' }))).toBe(CHECK);
  });

  it('las migraciones se revierten por completo', async () => {
    const other = await freshDatabase();
    try {
      await other.dataSource.undoLastMigration({ transaction: 'each' });
      const [{ n }] = await other.dataSource.query(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('carrito', 'carrito_item')`,
      );
      expect(n).toBe(0);
    } finally {
      await other.drop();
    }
  });
});
