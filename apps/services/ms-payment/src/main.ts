import { createEventBus, createLogger, listen, OutboxRelay } from '@atracciones/platform';
import { createMsPaymentService, readMsPaymentConfig } from './app';
import { WEBHOOK_QUEUE, WEBHOOK_ROUTING_KEY } from './application/webhook-processor';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-payment');
  const config = readMsPaymentConfig();
  for (const [name, value] of [['SERVICE_TOKEN', config.serviceToken], ['INTERNAL_TOKEN_SECRET', config.internalTokenSecret], ['WEBHOOK_SECRET', config.webhookSecret]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const bus = await createEventBus(process.env.RABBITMQ_URL);
  const { app, onWebhook } = createMsPaymentService(config, dataSource, { bus, logger });

  await bus.subscribe(WEBHOOK_QUEUE, [WEBHOOK_ROUTING_KEY], onWebhook);
  // Las claves de enrutamiento son `payment.PagoAprobado` y `payment.PagoRechazado`.
  new OutboxRelay(dataSource, bus, 'payment', { logger }).start();

  const server = await listen(app, config.port);
  logger.info('Payment (ms_payment) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
