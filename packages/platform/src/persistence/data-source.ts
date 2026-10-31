import 'reflect-metadata';
import { DataSource, type DataSourceOptions, type MixedList } from 'typeorm';

export interface DatabaseSettings {
  /** `postgres://usuario:clave@host:5432/base` */
  url: string;
  /** Azure Database for PostgreSQL exige TLS. */
  ssl?: boolean;
  /** Ejecuta las migraciones pendientes al iniciar. */
  migrationsRun?: boolean;
  logging?: boolean;
  /** Sin registro de TypeORM (pruebas que provocan errores de SQL a propósito). */
  silent?: boolean;
}

/** Lo que aporta cada microservicio: sus migraciones y, cuando existan, sus entidades. */
export interface ServicePersistence {
  migrations: MixedList<Function>;
  entities?: MixedList<Function>;
}

export function serviceDataSourceOptions(settings: DatabaseSettings, persistence: ServicePersistence): DataSourceOptions {
  return {
    type: 'postgres',
    url: settings.url,
    ssl: settings.ssl ? { rejectUnauthorized: true } : undefined,
    entities: persistence.entities ?? [],
    migrations: persistence.migrations,
    migrationsTableName: 'schema_migrations',
    // Cada migración en su propia transacción: si una falla, las anteriores quedan aplicadas y registradas.
    migrationsTransactionMode: 'each',
    migrationsRun: settings.migrationsRun ?? false,
    synchronize: false,
    logging: settings.silent ? false : settings.logging ? ['error', 'warn', 'migration'] : ['error', 'migration'],
    extra: { max: poolMax() },
  };
}

/** `DB_POOL_MAX` (por defecto 10). En Azure B1ms hay pocas conexiones para todas las apps: se baja a 3. */
function poolMax(): number {
  const value = Number(process.env.DB_POOL_MAX);
  return Number.isInteger(value) && value > 0 ? value : 10;
}

export function createServiceDataSource(settings: DatabaseSettings, persistence: ServicePersistence): DataSource {
  return new DataSource(serviceDataSourceOptions(settings, persistence));
}

/** URL local por defecto (PostgreSQL embebido de `npm run db:local`) para la base de un servicio. */
export const localDatabaseUrl = (database: string) =>
  process.env.DATABASE_URL ?? `postgres://postgres:tourgirls-local@localhost:5433/${database}`;
