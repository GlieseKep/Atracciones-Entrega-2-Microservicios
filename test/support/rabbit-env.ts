// Debe ser la primera importación de cada archivo E2E v3: fija el exchange y prefijo de pruebas antes de que se cargue
// `messaging.ts` (que los lee al importarse). El proyecto Jest `e2e` existente no se modifica.
process.env.RABBITMQ_EXCHANGE = 'pruebas.events';
process.env.RABBITMQ_PREFIX = 'pruebas';
delete process.env.RABBITMQ_URL;

export {};
