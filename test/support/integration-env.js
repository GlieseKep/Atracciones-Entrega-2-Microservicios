// Variables del proyecto Jest `integration`, fijadas antes de cargar cualquier módulo de la suite.
// `messaging.ts` lee RABBITMQ_EXCHANGE y RABBITMQ_PREFIX al importarse: con estos valores las pruebas usan un exchange
// y colas propios y no se mezclan con lo que levante start-microservices.ps1 en el mismo Docker.
// RABBITMQ_URL se borra a propósito: el bus de prueba se crea con la URL local fija de test/support/bus.ts.
process.env.RABBITMQ_EXCHANGE = 'pruebas.events';
process.env.RABBITMQ_PREFIX = 'pruebas';
delete process.env.RABBITMQ_URL;
delete process.env.DATABASE_URL;
