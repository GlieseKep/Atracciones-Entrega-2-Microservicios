import { createLogger, listen } from '@atracciones/platform';
import { createCartService, readCartConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('cart');
  const config = readCartConfig();
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app } = createCartService(config, dataSource);
  const server = await listen(app, config.port);
  logger.info('Cart listo', { port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
