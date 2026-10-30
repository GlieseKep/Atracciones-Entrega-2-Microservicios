import { createLogger, listen } from '@atracciones/platform';
import { createMsCouponService, readMsCouponConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-coupon');
  const config = readMsCouponConfig();
  for (const [name, value] of [['SERVICE_TOKEN', config.serviceToken], ['INTERNAL_TOKEN_SECRET', config.internalTokenSecret]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const app = createMsCouponService(config, dataSource, { logger });
  const server = await listen(app, config.port);
  logger.info('Coupon (ms_coupon) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
