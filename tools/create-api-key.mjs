// Emite una X-API-Key en ms_identity para un socio (p. ej. Booking Prototipo). La clave se muestra UNA sola vez: en la
// base solo queda su SHA-256. Es la misma que se envía a Booking en la ficha de registro y en BOOKING_API_KEY.
//
// Uso:  npm run build && node tools/create-api-key.mjs --codigo BOOKING_PROTOTIPO --nombre "Booking Prototipo"
//       DATABASE_URL=postgres://.../ms_identity  DATABASE_SSL=true   (por defecto, la base local de `npm run db:local`)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const identity = require(join(root, 'apps', 'services', 'ms-identity', 'dist', 'index.js'));

const { values } = parseArgs({ options: { codigo: { type: 'string' }, nombre: { type: 'string' } } });
if (!values.codigo || !values.nombre) {
  console.error('Uso: node tools/create-api-key.mjs --codigo <CODIGO_DEL_SOCIO> --nombre "<nombre del socio>"');
  process.exit(1);
}

const dataSource = identity.createDataSource({
  url: process.env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_identity',
  ssl: process.env.DATABASE_SSL === 'true',
});
await dataSource.initialize();
try {
  const service = new identity.ApiClientService(new identity.ApiClientRepository(dataSource));
  const client = await service.create(values.codigo, values.nombre);
  console.log(`Clave de API para '${client.nombre}' (${client.codigo}, id ${client.id}):\n\n  ${client.api_key}\n`);
  console.log('Guárdala por un canal privado. Va en la cabecera X-API-Key y no se puede volver a mostrar.');
} finally {
  await dataSource.destroy();
}
