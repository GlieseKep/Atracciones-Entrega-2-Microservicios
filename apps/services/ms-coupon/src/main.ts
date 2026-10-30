import { createLogger, listen } from '@atracciones/platform';
import { createMsCouponService, readMsCouponConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-coupon');
  const config = readMsCouponConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app } = createMsCouponService(config, dataSource, { logger });
  const server = await listen(app, config.port);
  logger.info('Coupon (ms_coupon) listo', { port: server.port, base_path: config.basePath, proveedor: config.providerCode, esb: config.esbUrl });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
