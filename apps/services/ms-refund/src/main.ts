import { createEventBus, createLogger, listen, OutboxRelay } from '@atracciones/platform';
import { createMsRefundService, readMsRefundConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-refund');
  const config = readMsRefundConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app } = createMsRefundService(config, dataSource, { logger });
  // Publica refund.ReembolsoEmitido (Invoicing emite la nota de crédito).
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'refund', { logger }).start();
  const server = await listen(app, config.port);
  logger.info('Refund (ms_refund) listo', { port: server.port, base_path: config.basePath, esb: config.esbUrl });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
