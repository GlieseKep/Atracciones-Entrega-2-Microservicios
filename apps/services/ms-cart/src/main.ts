import { createLogger, listen } from '@atracciones/platform';
import { createMsCartService, readMsCartConfig } from './app';
import { AbandonedCarts } from './application/abandoned-carts';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-cart');
  const config = readMsCartConfig();
  for (const [name, value] of [['SERVICE_TOKEN', config.serviceToken], ['INTERNAL_TOKEN_SECRET', config.internalTokenSecret]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app, cart } = createMsCartService(config, dataSource, { logger });
  new AbandonedCarts(cart, logger).start();
  const server = await listen(app, config.port);
  logger.info('Cart (ms_cart) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
