import { randomUUID } from 'node:crypto';
import type { DatabaseSettings } from '@atracciones/platform';
import { DataSource } from 'typeorm';
import * as audit from '../audit/src';
import * as booking from '../booking/src';
import * as cart from '../cart/src';
import * as catalog from '../catalog/src';
import * as identity from '../identity/src';
import * as inventory from '../inventory/src';
import * as invoicing from '../invoicing/src';
import * as order from '../order/src';
import * as payment from '../payment/src';

export const SERVICES = { identity, catalog, inventory, cart, order, booking, payment, invoicing, audit };
export type ServiceName = keyof typeof SERVICES;

const adminUrl = () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL no está definida (la define tools/test/global-setup.js).');
  return url;
};

const withDatabase = (url: string, database: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};

/** Ejecuta SQL en la base de administración de las pruebas (crear o borrar bases). */
async function admin(sql: string): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url: adminUrl() });
  await ds.initialize();
  try {
    await ds.query(sql);
  } finally {
    await ds.destroy();
  }
}

export interface ServiceDatabase {
  dataSource: DataSource;
  /** Revierte todas las migraciones, cierra la conexión y elimina la base. */
  drop(): Promise<void>;
}

/** Crea una base nueva y vacía para un servicio y le aplica sus migraciones. */
export async function migratedDatabase(service: ServiceName): Promise<ServiceDatabase> {
  const name = `${service}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await admin(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
  const settings: DatabaseSettings = { url: withDatabase(adminUrl(), name), silent: true };
  const dataSource = SERVICES[service].createDataSource(settings);
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'each' });
  return {
    dataSource,
    async drop() {
      if (dataSource.isInitialized) await dataSource.destroy();
      await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

/** Revierte todas las migraciones aplicadas, de la última a la primera. */
export async function revertAll(dataSource: DataSource): Promise<void> {
  while ((await dataSource.query(`SELECT count(*)::int AS n FROM schema_migrations`))[0].n > 0) {
    await dataSource.undoLastMigration({ transaction: 'each' });
  }
}

/** Tablas, vistas y vistas materializadas creadas por las migraciones (sin la tabla de control de TypeORM). */
export async function relations(dataSource: DataSource): Promise<string[]> {
  const rows: { name: string }[] = await dataSource.query(
    `SELECT CASE WHEN n.nspname = 'public' THEN c.relname ELSE n.nspname || '.' || c.relname END AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'v', 'm')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        AND c.relname <> 'schema_migrations'
      ORDER BY 1`,
  );
  return rows.map((r) => r.name);
}

/** Código SQLSTATE del error de PostgreSQL (TypeORM lo envuelve en QueryFailedError). */
export async function sqlState(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const e = error as { driverError?: { code?: string }; code?: string };
    return e.driverError?.code ?? e.code ?? 'SIN_CODIGO';
  }
  return 'SIN_ERROR';
}

export const SQLSTATE = {
  check: '23514',
  unique: '23505',
  foreignKey: '23503',
  notNull: '23502',
  exclusion: '23P01',
} as const;
