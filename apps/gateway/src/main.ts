import { createLogger } from '@atracciones/platform';
import { createGateway } from './app';
import { readGatewayConfig } from './config';

async function main() {
  const config = readGatewayConfig();
  const app = await createGateway(config);
  await app.listen(config.port, '0.0.0.0');
  createLogger('gateway').info('Gateway listo', { port: config.port, upstreams: config.upstreams });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
