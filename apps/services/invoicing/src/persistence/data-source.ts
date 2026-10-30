import { createServiceDataSource, localDatabaseUrl, type DatabaseSettings } from '@atracciones/platform';
import { MIGRATIONS } from './migrations';

export const DATABASE_NAME = 'invoicing_db';

export const createDataSource = (settings: DatabaseSettings) => createServiceDataSource(settings, { migrations: MIGRATIONS });

/** Instancia usada por la CLI de TypeORM (`migration:run`, `migration:revert`). */
export default createDataSource({ url: localDatabaseUrl(DATABASE_NAME), ssl: process.env.DATABASE_SSL === 'true' });
