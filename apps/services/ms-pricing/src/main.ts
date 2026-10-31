import { createEventBus, createLogger, createRpcHttpService, listen, OutboxRelay } from '@atracciones/platform';
import { createMsPricingService, readMsPricingConfig } from './app';
import { EffectiveTariffsJob } from './events/effective-tariffs-job';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-pricing');
  const config = readMsPricingConfig();
  for (const [name, value] of [['INTERNAL_TOKEN_SECRET', config.internalTokenSecret], ['SERVICE_TOKEN', config.serviceToken]]) {
    if (value.length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const pricing = createMsPricingService(config, dataSource, { logger });

  // La clave de enrutamiento es `pricing.TARIFA_ACTUALIZADA`.
  new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'pricing', { logger }).start();
  await new EffectiveTariffsJob(pricing.repository, logger).start();

  const app = createRpcHttpService({ service: 'ms-pricing', definition: pricing.definition, implementation: pricing.implementation, serviceToken: config.serviceToken, dataSource, logger });
  const server = await listen(app, config.port);
  logger.info('Pricing (ms_pricing) listo', { port: server.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
