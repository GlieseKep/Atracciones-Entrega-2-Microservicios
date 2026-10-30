import { createEventBus, createLogger, OutboxRelay, startGrpcServer } from '@atracciones/platform';
import { createBookingService, readBookingConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('booking');
  const config = readBookingConfig();
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const booking = createBookingService(config, dataSource, logger);
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'booking', { logger }).start();
  const server = await startGrpcServer([{ definition: booking.definition, implementation: booking.implementation }], config.grpcPort);
  logger.info('Booking listo', { grpc_port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
