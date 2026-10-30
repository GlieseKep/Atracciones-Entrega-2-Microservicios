import { createEventBus, createLogger, OutboxRelay, startGrpcServer } from '@atracciones/platform';
import { BookingStockSync } from './application/booking-stock-sync';
import { createInventoryService, readInventoryConfig } from './app';
import { createDataSource } from './persistence/data-source';
import { S } from './persistence/inventory-repository';

async function main() {
  const logger = createLogger('inventory');
  const config = readInventoryConfig();
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const inventory = createInventoryService(config, dataSource, logger);
  const prepared = await inventory.prepare();
  // Los turnos de los días siguientes se generan a partir de los horarios.
  setInterval(() => void inventory.prepare().catch((error) => logger.error('no se pudieron generar turnos', { error: String(error) })), 6 * 3_600_000).unref();

  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'inventory', { schema: S, logger }).start();
  if (config.bookingSync.enabled) new BookingStockSync(dataSource, config.bookingSync, logger).start();

  const server = await startGrpcServer(
    [
      { definition: inventory.definition, implementation: inventory.implementation },
      { definition: inventory.stockService.definition, implementation: inventory.stockService.implementation },
    ],
    config.grpcPort,
  );
  logger.info('Inventory listo', { grpc_port: server.port, booking: config.bookingSync.enabled ? config.bookingSync.address : 'desactivado', ...prepared });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
