import { createLogger, listen } from '@atracciones/platform';
import { createEsb, readEsbConfig } from './app';

async function main() {
  const config = readEsbConfig();
  const { app } = createEsb(config);
  const server = await listen(app, config.port);
  createLogger('esb').info('ESB listo', { port: server.port, destinos: config.targets });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
