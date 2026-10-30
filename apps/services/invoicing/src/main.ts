import { createEventBus, createLogger, errorFields, listen, OutboxRelay } from '@atracciones/platform';
import { createInvoicingService, readInvoicingConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('invoicing');
  const config = readInvoicingConfig();
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const service = createInvoicingService(config, dataSource, logger);
  const bus = await createEventBus(process.env.RABBITMQ_URL);
  await service.consume(bus);
  new OutboxRelay(dataSource, bus, 'invoicing', { logger }).start();
  // Worker de envío al SRI: ritmo controlado y reintento exponencial (plan D9).
  setInterval(() => void service.invoicing.processQueue().catch((error) => logger.error('falló el envío al SRI', errorFields(error))), config.workerIntervalMs).unref();
  const server = await listen(service.app, config.port);
  logger.info('Invoicing listo', { port: server.port, ambiente: config.emisor.ambiente === '1' ? 'PRUEBAS' : 'PRODUCCION' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
