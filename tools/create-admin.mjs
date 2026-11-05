// Crea el primer administrador de ms_identity. Solo funciona mientras no exista ninguno.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... node tools/create-admin.mjs
//
// Opcionales: ADMIN_NOMBRE, ADMIN_APELLIDO y DATABASE_URL (por defecto, la base local de `npm run db:local`).
// Requiere `npm run build` y `npm run db:migrate -- ms-identity`.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const identity = require(join(root, 'apps', 'services', 'ms-identity', 'dist', 'index.js'));

const correo = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!correo || !password || password.length < 8) {
  console.error('Defina ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres).');
  process.exit(1);
}

const dataSource = identity.createDataSource({
  url: process.env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_identity',
  ssl: process.env.DATABASE_SSL === 'true',
});
await dataSource.initialize();
try {
  const { users } = identity.createMsIdentityService(identity.readMsIdentityConfig(), dataSource);
  const admin = await users.createFirstAdmin({
    correo,
    password,
    nombre: process.env.ADMIN_NOMBRE ?? 'Administrador',
    apellido: process.env.ADMIN_APELLIDO ?? 'TourGirls',
  });
  console.log(`Administrador creado: ${admin.correo} (usu_id ${admin.id}).`);
} finally {
  await dataSource.destroy();
}
