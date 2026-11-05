import { createEventBus, createLogger, listen } from '@atracciones/platform';
import { createPartnerApi } from './app';
import { readPartnerApiConfig } from './config';

async function main() {
  const config = readPartnerApiConfig();
  const partner = createPartnerApi(config);
  const bus = await createEventBus(process.env.RABBITMQ_URL);
  await partner.invalidateOn(bus);
  partner.nodeHealth.watch(bus);
  const server = await listen(partner.app, config.port);
  createLogger('partner-api').info('Partner API lista', { port: server.port, validate_responses: config.validateResponses });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
