import { createEventBus, createLogger, OutboxRelay, startGrpcServer } from '@atracciones/platform';
import { createMsInventoryService, readMsInventoryConfig } from './app';
import { BookingStockSync } from './application/booking-stock-sync';
import { STOCK_EVENT } from './contract';
import { BookingStockClient } from './integration/booking-stock-client';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-inventory');
  const config = readMsInventoryConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const inventory = createMsInventoryService(config, dataSource, { logger });

  // `CupoBloqueado` y `CupoLiberado` van al bus; el stock lo entrega BookingStockSync.
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'inventory', { logger, excludeTypes: [STOCK_EVENT] }).start();
  if (config.bookingSyncEnabled) new BookingStockSync(dataSource, new BookingStockClient(config.booking), logger).start();
  await inventory.generator.start();

  const server = await startGrpcServer([{ definition: inventory.definition, implementation: inventory.implementation }], config.grpcPort);
  logger.info('Inventory (ms_inventory) listo', { grpc_port: server.port, booking: config.bookingSyncEnabled ? config.booking.address : 'desactivado' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
