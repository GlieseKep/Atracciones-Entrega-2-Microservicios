import { createLogger, listen } from '@atracciones/platform';
import { createIdentityService, readIdentityConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('identity');
  const config = readIdentityConfig();
  if (!config.privateKeyPem) logger.warn('JWT_PRIVATE_KEY_PEM no está definida: se usa una clave efímera (los tokens dejan de valer al reiniciar).');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app, accounts } = await createIdentityService(config, dataSource);
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const admin = await accounts.ensureAdmin({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    if (admin.created) logger.info('administrador inicial creado', { email: process.env.ADMIN_EMAIL });
  }
  const server = await listen(app, config.port);
  logger.info('Identity listo', { port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
