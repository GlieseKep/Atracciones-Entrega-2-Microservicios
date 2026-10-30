// Emite una X-API-Key para un socio (p. ej. Booking Prototipo). La clave se muestra UNA sola vez: en identity_db solo
// queda su SHA-256. Crea, si no existe, el usuario socio (tipo PARTNER) con el rol `partner` y sus scopes.
//
// Uso:  npm run build && node tools/create-api-key.mjs --nombre booking-prototipo --email integracion@booking.epn.edu.ec
//       DATABASE_URL=postgres://.../identity_db   (por defecto, la base local de `npm run db:local`)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const identity = require(join(root, 'apps', 'services', 'identity', 'dist', 'index.js'));

const { values } = parseArgs({ options: { nombre: { type: 'string' }, email: { type: 'string' } } });
if (!values.nombre || !values.email) {
  console.error('Uso: node tools/create-api-key.mjs --nombre <nombre-del-socio> --email <correo-del-socio>');
  process.exit(1);
}

const dataSource = identity.createDataSource({
  url: process.env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/identity_db',
  ssl: process.env.DATABASE_SSL === 'true',
});
await dataSource.initialize();
try {
  const tokens = await identity.TokenIssuer.create({ issuer: 'cli', audience: 'cli', ttlSeconds: 60 });
  const accounts = new identity.AccountService(new identity.IdentityRepository(dataSource), tokens);
  const { apiKey, scopes } = await accounts.createApiKey({ nombre: values.nombre, email: values.email });
  console.log(`Clave de API para '${values.nombre}' (scopes: ${scopes.join(' ')}):\n\n  ${apiKey}\n`);
  console.log('Entrégala por un canal privado y envíala en la cabecera X-API-Key. No se puede volver a mostrar.');
} finally {
  await dataSource.destroy();
}
