import { createLogger, listen } from '@atracciones/platform';
import { createMsCartService, readMsCartConfig } from './app';
import { startAbandonedCartSweeper } from './application/abandoned-carts';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-cart');
  const config = readMsCartConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app, repository } = createMsCartService(config, dataSource, { logger });
  void startAbandonedCartSweeper(repository, config.ttlDays, logger)();
  const server = await listen(app, config.port);
  logger.info('Cart (ms_cart) listo', { port: server.port, base_path: config.basePath, esb: config.esbUrl });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
