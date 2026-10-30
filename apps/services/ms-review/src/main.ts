import { createEventBus, createLogger, listen, OutboxRelay } from '@atracciones/platform';
import { createMsReviewService, readMsReviewConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-review');
  const config = readMsReviewConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const app = createMsReviewService(config, dataSource, { logger });

  // La clave de enrutamiento es `review.RESENA_PUBLICADA`.
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'review', { logger }).start();

  const server = await listen(app, config.port);
  logger.info('Review (ms_review) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
