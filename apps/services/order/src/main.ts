import { createEventBus, createLogger, OutboxRelay, errorFields, startGrpcServer } from '@atracciones/platform';
import { createOrderService, readOrderConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('order');
  const config = readOrderConfig();
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const order = createOrderService(config, dataSource, logger);
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'order', { logger }).start();
  const server = await startGrpcServer([{ definition: order.definition, implementation: order.implementation }], config.grpcPort);
  // Worker de recuperación: compensa las sagas que quedaron a medias (plan §3.5).
  setInterval(() => {
    order.recoverStuckSagas()
      .then((n) => n > 0 && logger.info('sagas recuperadas', { cantidad: n }))
      .catch((error) => logger.error('falló la recuperación de sagas', errorFields(error)));
  }, 30_000).unref();
  logger.info('Order listo', { grpc_port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
