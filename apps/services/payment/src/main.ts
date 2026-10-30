import { createEventBus, createLogger, OutboxRelay, listen } from '@atracciones/platform';
import { createPaymentService, readPaymentConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const config = readPaymentConfig();
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app } = createPaymentService(config, dataSource);
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'payment').start();
  const server = await listen(app, config.port);
  createLogger('payment').info('Payment listo', { port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
