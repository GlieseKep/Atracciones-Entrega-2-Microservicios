import { MS_SERVICES, msDatabase, type MsDatabase, type MsServiceName } from '../support/db';

/** Tablas, restricciones CHECK/UNIQUE y claves foráneas que dejan las migraciones de una base. */
async function schemaOf(db: MsDatabase) {
  const q = (sql: string) => db.dataSource.query(sql) as Promise<{ name: string }[]>;
  const tables = await q(`SELECT n.nspname || '.' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relname <> 'schema_migrations'`);
  const constraints = await q(`SELECT conname || ':' || contype::text AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                                WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')`);
  const migrations = await q(`SELECT name FROM schema_migrations`);
  return { tables: tables.map((r) => r.name), constraints: constraints.map((r) => r.name), migrations: migrations.map((r) => r.name) };
}

/** Lo mínimo que cada servicio del alcance debe dejar creado (tablas que usan los procesos P1–P13). */
const EXPECTED: Record<MsServiceName, string[]> = {
  'ms-catalog': ['atraccion', 'categoria'],
  'ms-inventory': ['outbox'],
  'ms-booking': ['reserva', 'reserva_pasajero', 'outbox_evento', 'idempotencia', 'estado', 'notificacion_checkin'],
  'ms-coupon': [],
  'ms-identity': ['cliente_api'],
  'ms-order': ['orden', 'orden_detalle', 'outbox'],
  'ms-pricing': ['outbox'],
  'ms-payment': ['outbox'],
  'ms-refund': ['outbox'],
  'ms-location': ['ciudad', 'provincia'],
  'ms-billing-profile': [],
  'ms-review': ['outbox'],
};

describe('Migraciones de los 12 servicios · base ms_* desde cero', () => {
  const services = Object.keys(MS_SERVICES) as MsServiceName[];

  it.each(services)('%s · migra desde cero y deja tablas, claves primarias y foráneas', async (service) => {
    const db = await msDatabase(service);
    try {
      const schema = await schemaOf(db);
      expect(schema.migrations.length).toBeGreaterThan(0);
      expect(schema.tables.length).toBeGreaterThan(0);
      const names = schema.tables.map((t) => t.split('.')[1]);
      for (const table of EXPECTED[service]) expect(names).toContain(table);
      // Toda tabla tiene clave primaria.
      expect(schema.constraints.filter((c) => c.endsWith(':p')).length).toBeGreaterThanOrEqual(schema.tables.length);
      // Las bases con más de una tabla enlazan sus tablas con claves foráneas.
      if (schema.tables.length > 2) expect(schema.constraints.some((c) => c.endsWith(':f'))).toBe(true);
      // Las migraciones no quedan pendientes: correrlas otra vez no hace nada.
      await expect(db.dataSource.runMigrations({ transaction: 'each' })).resolves.toEqual([]);
    } finally {
      await db.drop();
    }
  });
});
