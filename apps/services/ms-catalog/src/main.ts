import { createEventBus, createLogger, listen } from '@atracciones/platform';
import { createMsCatalogService, readMsCatalogConfig } from './app';
import { EVENT_PATTERNS, EVENT_QUEUE } from './application/event-handlers';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-catalog');
  const config = readMsCatalogConfig();
  for (const [name, value] of [['SERVICE_TOKEN', config.serviceToken], ['INTERNAL_TOKEN_SECRET', config.internalTokenSecret]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app, onEvent } = createMsCatalogService(config, dataSource, { logger });
  const bus = await createEventBus(process.env.RABBITMQ_URL);
  await bus.subscribe(EVENT_QUEUE, EVENT_PATTERNS, onEvent);
  const server = await listen(app, config.port);
  logger.info('Catalog (ms_catalog) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
