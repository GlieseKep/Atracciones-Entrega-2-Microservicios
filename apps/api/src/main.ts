import { Logger } from '@nestjs/common';
import { createApp, initializeDatabase } from './bootstrap';
import { loadEnvFile, readConfig } from './config';

async function main(): Promise<void> {
  loadEnvFile();
  const config = readConfig();
  const dataSource = await initializeDatabase(config);
  const app = await createApp(config, dataSource);
  app.enableShutdownHooks();
  // Sin host explícito: doble pila IPv4/IPv6 (`localhost` resuelve primero a ::1).
  await app.listen(config.port);
  const logger = new Logger('Bootstrap');
  logger.log(`API escuchando en el puerto ${config.port} (prefijo /internal/web/v1).`);
  if (config.swaggerEnabled) logger.log(`Swagger: http://localhost:${config.port}/docs`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
