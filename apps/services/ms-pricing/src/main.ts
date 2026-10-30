import { createEventBus, createLogger, OutboxRelay, startGrpcServer } from '@atracciones/platform';
import { createMsPricingService, readMsPricingConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-pricing');
  const config = readMsPricingConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const pricing = createMsPricingService(config, dataSource, logger);

  // TARIFA_ACTUALIZADA: el outbox se publica en el bus (RabbitMQ; en memoria si no hay RABBITMQ_URL).
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'ms-pricing', { logger }).start();

  const server = await startGrpcServer([{ definition: pricing.definition, implementation: pricing.implementation }], config.grpcPort);
  logger.info('Pricing (ms_pricing) listo', { grpc_port: server.port, bus: process.env.RABBITMQ_URL ? 'rabbitmq' : 'memoria' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
