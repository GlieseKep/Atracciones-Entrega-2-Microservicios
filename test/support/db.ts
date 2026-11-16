import { randomUUID } from 'node:crypto';
import type { DatabaseSettings } from '@atracciones/platform';
import { DataSource } from 'typeorm';
import * as msBillingProfile from '../../apps/services/ms-billing-profile/src';
import * as msBooking from '../../apps/services/ms-booking/src';
import * as msCatalog from '../../apps/services/ms-catalog/src';
import * as msCoupon from '../../apps/services/ms-coupon/src';
import * as msIdentity from '../../apps/services/ms-identity/src';
import * as msInventory from '../../apps/services/ms-inventory/src';
import * as msLocation from '../../apps/services/ms-location/src';
import * as msOrder from '../../apps/services/ms-order/src';
import * as msPayment from '../../apps/services/ms-payment/src';
import * as msPricing from '../../apps/services/ms-pricing/src';
import * as msRefund from '../../apps/services/ms-refund/src';
import * as msReview from '../../apps/services/ms-review/src';

/** Los 12 microservicios del alcance (sección 0.2 del inventario), cada uno con su base `ms_*`. */
export const MS_SERVICES = {
  'ms-catalog': msCatalog,
  'ms-inventory': msInventory,
  'ms-booking': msBooking,
  'ms-coupon': msCoupon,
  'ms-identity': msIdentity,
  'ms-order': msOrder,
  'ms-pricing': msPricing,
  'ms-payment': msPayment,
  'ms-refund': msRefund,
  'ms-location': msLocation,
  'ms-billing-profile': msBillingProfile,
  'ms-review': msReview,
} as const;

export type MsServiceName = keyof typeof MS_SERVICES;

const adminUrl = (): string => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL no está definida (la define tools/test/global-setup.js).');
  return url;
};

const withDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
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

export interface MsDatabase {
  name: string;
  url: string;
  settings: DatabaseSettings;
  dataSource: DataSource;
  /** Cierra la conexión y elimina la base. */
  drop(): Promise<void>;
}

/** Crea una base vacía `ms_<servicio>_<azar>` y, salvo `migrate: false`, le aplica las migraciones del servicio. */
export async function msDatabase(service: MsServiceName, options: { migrate?: boolean } = {}): Promise<MsDatabase> {
  const name = `${service.replace(/-/g, '_')}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  await admin(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
  const url = withDatabase(adminUrl(), name);
  const settings: DatabaseSettings = { url, silent: true };
  const dataSource = MS_SERVICES[service].createDataSource(settings);
  await dataSource.initialize();
  if (options.migrate !== false) await dataSource.runMigrations({ transaction: 'each' });
  return {
    name,
    url,
    settings,
    dataSource,
    async drop() {
      if (dataSource.isInitialized) await dataSource.destroy();
      await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
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

export const SQLSTATE = { check: '23514', unique: '23505', foreignKey: '23503', notNull: '23502' } as const;
