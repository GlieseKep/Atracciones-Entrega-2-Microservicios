import { createEventBus, createLogger, startGrpcServer } from '@atracciones/platform';
import { createMsBookingService, readMsBookingConfig } from './app';
import { EventPublisher } from './application/event-publisher';
import { EVENT_PATTERNS, EVENT_QUEUE } from './application/payment-events';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-booking');
  const config = readMsBookingConfig();
  for (const [name, value] of [['INTERNAL_TOKEN_SECRET', config.internalTokenSecret], ['VOUCHER_SECRET', config.voucherSecret]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const booking = createMsBookingService(config, dataSource, { logger });
  const bus = await createEventBus(process.env.RABBITMQ_URL);

  await bus.subscribe(EVENT_QUEUE, EVENT_PATTERNS, booking.onEvent);
  new EventPublisher(dataSource, booking.events, bus, logger).start();
  booking.lifecycle.start();

  const server = await startGrpcServer([{ definition: booking.definition, implementation: booking.implementation }], config.grpcPort);
  logger.info('Booking (ms_booking) listo', { grpc_port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
