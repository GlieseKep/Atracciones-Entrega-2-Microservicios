import { createEventBus, createLogger, listen } from '@atracciones/platform';
import { createMsAuditService, readMsAuditConfig } from './app';
import { EVENT_PATTERNS, EVENT_QUEUE } from './application/event-recorder';
import { createDataSource } from './persistence/data-source';

async function main() {
  const logger = createLogger('ms-audit');
  const config = readMsAuditConfig();
  if (config.internalTokenSecret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const dataSource = createDataSource({ ...config.database, migrationsRun: true });
  await dataSource.initialize();
  const { app, onEvent } = createMsAuditService(config, dataSource, { logger });
  const bus = await createEventBus(process.env.RABBITMQ_URL);

  await bus.subscribe(EVENT_QUEUE, EVENT_PATTERNS, onEvent);

  const server = await listen(app, config.port);
  logger.info('Audit (ms_audit) listo', { port: server.port, base_path: config.basePath });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
