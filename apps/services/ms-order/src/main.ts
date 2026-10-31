import { createEventBus, createLogger, OutboxRelay, startGrpcServer } from '@atracciones/platform';
import { createMsOrderService, readMsOrderConfig } from './app';
import { CartSync } from './application/cart-sync';
import { EVENT_PATTERNS, EVENT_QUEUE } from './application/payment-events';
import { CART_SYNC_EVENT } from './contract';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-order');
  const config = readMsOrderConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const order = createMsOrderService(config, dataSource, { logger });
  const bus = await createEventBus(process.env.RABBITMQ_URL);

  await bus.subscribe(EVENT_QUEUE, EVENT_PATTERNS, order.onEvent);
  // `OrdenCreada` y `OrdenPagada` van al bus; los avisos a Cart los entrega CartSync.
  new OutboxRelay(dataSource, bus, 'order', { logger, excludeTypes: [CART_SYNC_EVENT] }).start();
  new CartSync(dataSource, order.esb, logger).start();
  order.staleOrders.start();

  const server = await startGrpcServer([{ definition: order.definition, implementation: order.implementation }], config.grpcPort);
  logger.info('Order (ms_order) listo', { grpc_port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
