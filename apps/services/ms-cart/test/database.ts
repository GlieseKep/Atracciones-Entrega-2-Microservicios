import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDataSource } from '../src';

const adminUrl = () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL no está definida (la define tools/test/global-setup.js).');
  return url;
};

async function admin(sql: string): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url: adminUrl() });
  await ds.initialize();
  try {
    await ds.query(sql);
  } finally {
    await ds.destroy();
  }
}

export interface TestDatabase {
  url: string;
  dataSource: DataSource;
  drop(): Promise<void>;
}

/** Base ms_cart nueva y vacía en el PostgreSQL embebido de las pruebas, con las migraciones aplicadas. */
export async function freshDatabase(): Promise<TestDatabase> {
  const name = `ms_cart_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await admin(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
  const parsed = new URL(adminUrl());
  parsed.pathname = `/${name}`;
  const url = parsed.toString();
  const dataSource = createDataSource({ url, silent: true });
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'each' });
  return {
    url,
    dataSource,
    async drop() {
      if (dataSource.isInitialized) await dataSource.destroy();
      await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

/** Código de error de PostgreSQL de una consulta rechazada. */
export async function pgError(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    return (error as { driverError?: { code?: string } }).driverError?.code ?? String(error);
  }
}
