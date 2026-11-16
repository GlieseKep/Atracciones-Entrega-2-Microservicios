import amqp from 'amqplib';
import { createEventBus, EXCHANGE, type EventBus } from '@atracciones/platform';

/**
 * RabbitMQ local de las pruebas (docker compose -f infra/docker-compose.yml up -d rabbitmq, o el contenedor de servicio
 * en CI). La URL va fija aquí y no se lee RABBITMQ_URL del entorno: las pruebas no pueden llegar al RabbitMQ real.
 */
export const TEST_RABBITMQ_URL = 'amqp://guest:guest@localhost:5672';

const queuesCreated = new Set<string>();

/** Bus real contra el RabbitMQ local, con el exchange y prefijo de pruebas (test/support/integration-env.js). */
export async function testBus(): Promise<EventBus> {
  if (EXCHANGE !== 'pruebas.events') throw new Error(`El bus de pruebas debe usar el exchange 'pruebas.events', no '${EXCHANGE}'.`);
  return createEventBus(TEST_RABBITMQ_URL);
}

/** Registra una cola creada por la suite para borrarla al final. */
export function trackQueue(queue: string): string {
  queuesCreated.add(queue);
  return queue;
}

/** Borra las colas registradas (y sus DLQ) y el exchange de pruebas. No toca nada fuera de `pruebas.*`. */
export async function cleanTestBus(): Promise<void> {
  const connection = await amqp.connect(TEST_RABBITMQ_URL);
  try {
    const channel = await connection.createChannel();
    for (const queue of queuesCreated) {
      for (const name of [`pruebas.${queue}`, `pruebas.${queue}.dlq`, queue, `${queue}.dlq`]) {
        if (!name.startsWith('pruebas.')) continue;
        await channel.deleteQueue(name).catch(() => undefined);
      }
    }
    await channel.deleteExchange('pruebas.events').catch(() => undefined);
    await channel.deleteExchange('pruebas.atracciones.events.dlx').catch(() => undefined);
    await channel.close().catch(() => undefined);
  } finally {
    await connection.close().catch(() => undefined);
  }
  queuesCreated.clear();
}

/** Espera con sondeo (sin esperas fijas) a que `check` devuelva un valor distinto de null/undefined/false. */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false> | T | null | undefined | false, timeoutMs = 10_000, everyMs = 50): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value !== null && value !== undefined && value !== false) return value as T;
    } catch (error) {
      last = error;
    }
    if (Date.now() > until) throw new Error(`waitFor: tiempo agotado tras ${timeoutMs} ms${last ? ` (${String(last)})` : ''}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
