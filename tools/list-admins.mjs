// Lista los usuarios con rol ADMIN de ms_identity, para saber si hace falta crear el primero (tools/create-admin.mjs).
//
//   DATABASE_URL=postgres://.../ms_identity DATABASE_SSL=true node tools/list-admins.mjs
//
// Por defecto usa la base local de `npm run db:local`. Solo lee: no cambia nada.
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_identity';
const client = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
await client.connect();
try {
  const [{ exists }] = (await client.query(`SELECT to_regclass('public.usuario') IS NOT NULL AS exists`)).rows;
  if (!exists) {
    console.log('La base no tiene las tablas de Identity: ejecute primero  npm run db:migrate -- ms-identity');
    process.exit(2);
  }
  const { rows } = await client.query(
    `SELECT u.usu_id, u.usu_correo, u.usu_nombre, u.usu_apellido, u.usu_activo, u.usu_creado_en
       FROM usuario u
       JOIN usuario_rol ur ON ur.usu_id = u.usu_id
       JOIN rol r ON r.rol_id = ur.rol_id AND r.rol_nombre = 'ADMIN'
      ORDER BY u.usu_id`,
  );
  const { rows: [{ total }] } = await client.query('SELECT count(*)::int AS total FROM usuario');
  if (rows.length === 0) {
    console.log(`No hay ningún administrador (usuarios en total: ${total}). Créelo con  node tools/create-admin.mjs`);
  } else {
    console.log(`Administradores (${rows.length}) de ${total} usuarios:`);
    for (const r of rows) {
      console.log(`  #${r.usu_id}  ${r.usu_correo}  ${r.usu_nombre} ${r.usu_apellido}  ${r.usu_activo ? 'activo' : 'INACTIVO'}  creado ${r.usu_creado_en.toISOString().slice(0, 10)}`);
    }
  }
} finally {
  await client.end();
}
