import { createEventBus, createLogger, listen, OutboxRelay } from '@atracciones/platform';
import { createMsInvoicingService, readMsInvoicingConfig } from './app';
import { EVENT_PATTERNS, EVENT_QUEUE } from './application/invoice-service';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-invoicing');
  const config = readMsInvoicingConfig();
  for (const [name, value] of [['SERVICE_TOKEN', config.serviceToken], ['INTERNAL_TOKEN_SECRET', config.internalTokenSecret]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app, onEvent, sriQueue } = createMsInvoicingService(config, dataSource, { logger });
  const bus = await createEventBus(process.env.RABBITMQ_URL);

  await bus.subscribe(EVENT_QUEUE, EVENT_PATTERNS, onEvent);
  // La clave de enrutamiento es `invoicing.FacturaAutorizada`.
  new OutboxRelay(dataSource, bus, 'invoicing', { logger }).start();
  sriQueue.start();

  const server = await listen(app, config.port);
  logger.info('Invoicing (ms_invoicing) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
