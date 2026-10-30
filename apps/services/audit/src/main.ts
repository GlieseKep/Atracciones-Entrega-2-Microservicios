import { createEventBus, createLogger, listen } from '@atracciones/platform';
import { createAuditService, readAuditConfig } from './app';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('audit');
  const config = readAuditConfig();
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const audit = createAuditService(config, dataSource, logger);
  await audit.consume(await createEventBus(config.rabbitmqUrl));
  const server = await listen(audit.app, config.port);
  logger.info('Audit listo', { port: server.port, bus: config.rabbitmqUrl ? 'rabbitmq' : 'memoria' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
