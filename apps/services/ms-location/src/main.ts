import { createLogger, listen } from '@atracciones/platform';
import { createMsLocationService, readMsLocationConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-location');
  const config = readMsLocationConfig();
  if (config.serviceToken.length < 32) throw new Error('SERVICE_TOKEN debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const app = await createMsLocationService(config, dataSource, { logger });
  const server = await listen(app, config.port);
  logger.info('Location (ms_location) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
