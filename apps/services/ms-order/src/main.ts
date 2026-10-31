import { createEventBus, createLogger, createRpcHttpService, listen, OutboxRelay } from '@atracciones/platform';
import { createMsOrderService, readMsOrderConfig } from './app';
import { CartSync } from './application/cart-sync';
import { EVENT_PATTERNS, EVENT_QUEUE } from './application/payment-events';
import { CART_SYNC_EVENT } from './contract';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-order');
  const config = readMsOrderConfig();
  for (const [name, value] of [['INTERNAL_TOKEN_SECRET', config.internalTokenSecret], ['SERVICE_TOKEN', config.serviceToken]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const order = createMsOrderService(config, dataSource, { logger });
  const bus = await createEventBus(process.env.RABBITMQ_URL);

  await bus.subscribe(EVENT_QUEUE, EVENT_PATTERNS, order.onEvent);
  // `OrdenCreada` y `OrdenPagada` van al bus; los avisos a Cart los entrega CartSync.
  new OutboxRelay(dataSource, bus, 'order', { logger, excludeTypes: [CART_SYNC_EVENT] }).start();
  new CartSync(dataSource, order.esb, logger).start();
  order.staleOrders.start();

  const app = createRpcHttpService({ service: 'ms-order', definition: order.definition, implementation: order.implementation, serviceToken: config.serviceToken, dataSource, logger });
  const server = await listen(app, config.port);
  logger.info('Order (ms_order) listo', { port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
