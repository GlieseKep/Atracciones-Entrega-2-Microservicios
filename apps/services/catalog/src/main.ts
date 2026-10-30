import { createEventBus, createLogger, listen, OutboxRelay } from '@atracciones/platform';
import { createCatalogService, readCatalogConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('catalog');
  const config = readCatalogConfig();
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const catalog = createCatalogService(config, dataSource);
  const prepared = await catalog.prepare();
  const bus = await createEventBus(process.env.RABBITMQ_URL);
  await catalog.consume(bus);
  new OutboxRelay(dataSource, bus, 'catalog', { logger }).start();
  const server = await listen(catalog.app, config.port);
  logger.info('Catalog listo', { port: server.port, ...prepared });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
