import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { EXCHANGE, type EventBus, type EventEnvelope } from '@atracciones/platform';
import { cleanTestBus, testBus, TEST_RABBITMQ_URL, trackQueue, waitFor } from '../../../test/support/bus';

/** 4.2 · messaging.ts contra el RabbitMQ local (docker compose -f infra/docker-compose.yml up -d rabbitmq). */
describe('platform/messaging · RabbitMQ local', () => {
  let bus: EventBus;
  const envelope = (type: string): EventEnvelope => ({ specversion: '1.0', id: randomUUID(), source: '/servicios/pruebas', type, subject: 'x', time: new Date().toISOString(), correlation_id: 'cid-mq', data: { n: 1 } });

  beforeAll(async () => {
    bus = await testBus();
  });
  afterAll(async () => {
    await bus?.close();
    await cleanTestBus();
  });

  it('exchange de pruebas y routing keys con prefijo: un patrón solo recibe sus eventos', async () => {
    expect(EXCHANGE).toBe('pruebas.events');
    const received: string[] = [];
    await bus.subscribe(trackQueue(`mq-a-${randomUUID().slice(0, 6)}`), ['payment.*'], async (e) => { received.push(e.type); });
    await bus.publish('payment.PagoAprobado', envelope('PagoAprobado'));
    await bus.publish('order.OrdenCreada', envelope('OrdenCreada'));
    await waitFor(() => received.length >= 1);
    await new Promise((r) => setImmediate(r));
    expect(received).toEqual(['PagoAprobado']);
    expect(bus.status()).toBe('CONNECTED');
  });

  it('cada consumidor tiene su propia cola: dos colas reciben el mismo evento', async () => {
    const a: string[] = [];
    const b: string[] = [];
    await bus.subscribe(trackQueue(`mq-b1-${randomUUID().slice(0, 6)}`), ['review.#'], async (e) => { a.push(e.id); });
    await bus.subscribe(trackQueue(`mq-b2-${randomUUID().slice(0, 6)}`), ['review.#'], async (e) => { b.push(e.id); });
    const event = envelope('RESENA_PUBLICADA');
    await bus.publish('review.RESENA_PUBLICADA', event);
    await waitFor(() => a.length === 1 && b.length === 1);
    expect(a).toEqual([event.id]);
    expect(b).toEqual([event.id]);
  });

  it('mensaje no procesable (JSON inválido o handler que siempre falla) termina en la DLQ de la cola', async () => {
    const name = trackQueue(`mq-dlq-${randomUUID().slice(0, 6)}`);
    await bus.subscribe(name, ['refund.*'], async () => { throw new Error('no procesable'); });
    await bus.publish('refund.ReembolsoEmitido', envelope('ReembolsoEmitido'));
    const connection = await amqp.connect(TEST_RABBITMQ_URL);
    try {
      const channel = await connection.createChannel();
      await channel.publish(EXCHANGE, 'pruebas.refund.Roto', Buffer.from('{no es json'));
      const count = await waitFor(async () => {
        const { messageCount } = await channel.checkQueue(`pruebas.${name}.dlq`);
        return messageCount >= 2 ? messageCount : null;
      }, 15_000);
      expect(count).toBe(2);
      await channel.close();
    } finally {
      await connection.close();
    }
  });
});
