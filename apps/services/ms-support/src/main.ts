import { createLogger, listen } from '@atracciones/platform';
import { createMsSupportService, readMsSupportConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-support');
  const config = readMsSupportConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const server = await listen(createMsSupportService(config, dataSource, { logger }), config.port);
  logger.info('Support (ms_support) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
