// Crea la base de datos de cada microservicio (si no existe) y le aplica sus migraciones pendientes.
//
// Uso:  npm run build && npm run db:migrate                 (todas, contra el PostgreSQL local de `npm run db:local`)
//       npm run db:migrate -- catalog inventory              (solo esos servicios)
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base; la base de cada servicio se agrega al final.
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const all = JSON.parse(readFileSync(join(root, 'apps', 'services', 'services.json'), 'utf8'));
const selected = process.argv.slice(2);
const unknown = selected.filter((s) => !all.includes(s));
if (unknown.length > 0) throw new Error(`Servicios desconocidos: ${unknown.join(', ')}. Disponibles: ${all.join(', ')}.`);

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true';

const admin = new pg.Client({ connectionString: `${base}postgres`, ssl: ssl ? { rejectUnauthorized: true } : undefined });
await admin.connect();
try {
  for (const name of selected.length > 0 ? selected : all) {
    const service = require(join(root, 'apps', 'services', name, 'dist', 'index.js'));
    const database = service.DATABASE_NAME;
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rowCount === 0) {
      // El nombre viene del código del servicio (no de la entrada del usuario).
      await admin.query(`CREATE DATABASE "${database}" ENCODING 'UTF8' TEMPLATE template0`);
      console.log(`[${name}] Base de datos ${database} creada.`);
    }
    const dataSource = service.createDataSource({ url: `${base}${database}`, ssl });
    await dataSource.initialize();
    try {
      const applied = await dataSource.runMigrations({ transaction: 'each' });
      const summary = applied.length === 0
        ? 'al día'
        : `${applied.length} ${applied.length === 1 ? 'migración aplicada' : 'migraciones aplicadas'} (${applied.map((m) => m.name).join(', ')})`;
      console.log(`[${name}] ${database}: ${summary}.`);
    } finally {
      await dataSource.destroy();
    }
  }
} finally {
  await admin.end();
}
