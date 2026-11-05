import { createEventBus, createLogger, listen, OutboxRelay } from '@atracciones/platform';
import { createMsIdentityService, readMsIdentityConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-identity');
  const config = readMsIdentityConfig();
  for (const [name, value] of [['JWT_SECRET', config.jwtSecret], ['SERVICE_TOKEN', config.serviceToken], ['INTERNAL_TOKEN_SECRET', config.internalTokenSecret]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app } = createMsIdentityService(config, dataSource, { logger });
  // Cambios de roles, cuentas y socios hacia el bus: ms-audit los guarda en la bitácora.
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'identity', { logger }).start();
  const server = await listen(app, config.port);
  logger.info('Identity (ms_identity) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
