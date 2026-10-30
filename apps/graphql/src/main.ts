import { createEventBus, createLogger, listen } from '@atracciones/platform';
import { createGraphqlServer } from './app';
import { readGraphqlConfig } from './config';

async function main() {
  const logger = createLogger('graphql');
  const config = readGraphqlConfig();
  const server = await createGraphqlServer(config);
  await server.invalidateOn(await createEventBus(process.env.RABBITMQ_URL ?? null));
  const running = await listen(server.app, config.port);
  logger.info('GraphQL listo', { port: running.port, cache: config.redisUrl ? 'redis' : 'memoria' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
