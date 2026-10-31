import amqp from 'amqplib';
import { runWithContext } from './correlation';
import { createLogger, errorFields, type Logger } from './logging';

/** Evento de dominio en el sobre CloudEvents 1.0 (plan §6.2). */
export interface EventEnvelope {
  specversion: '1.0';
  /** Identificador único del evento (deduplicación en los consumidores). */
  id: string;
  /** Servicio productor, p. ej. `/servicios/booking`. */
  source: string;
  /** Tipo de evento interno, p. ej. `ReservaEmitida`. */
  type: string;
  /** Agregado afectado (PNR, código de atracción, código de orden…). */
  subject: string;
  time: string;
  correlation_id: string;
  data: Record<string, unknown>;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

/**
 * Bus de eventos (plan D5). Clave de enrutamiento `<servicio>.<TipoEvento>`; cada consumidor tiene su propia cola y
 * recibe los eventos de los patrones a los que se suscribe (`#` = todos, `booking.*` = los de Booking).
 */
export interface EventBus {
  publish(routingKey: string, event: EventEnvelope): Promise<void>;
  subscribe(queue: string, patterns: string[], handler: EventHandler): Promise<void>;
  close(): Promise<void>;
}

/** `booking.*`, `#`, `inventory.DisponibilidadActualizada` → expresión regular sobre la clave de enrutamiento. */
export function topicMatcher(pattern: string): RegExp {
  const parts = pattern.split('.').map((p) => (p === '#' ? '.*' : p === '*' ? '[^.]+' : p.replace(/[$()*+?[\\\]^{|}]/g, '\\$&')));
  return new RegExp(`^${parts.join('\\.')}$`);
}

const RETRIES = 3;

/** Ejecuta el handler con el contexto del evento (su correlation_id aparece en los logs) y reintenta con espera creciente. */
async function deliver(handler: EventHandler, event: EventEnvelope): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await runWithContext({ correlationId: event.correlation_id }, () => handler(event));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
    }
  }
  throw lastError;
}

/**
 * Bus en memoria para desarrollo en un solo proceso y pruebas. Entrega a cada cola en orden de publicación y, tras
 * agotar los reintentos, deja el evento en `deadLetters` (equivalente a la DLQ).
 */
export class InMemoryEventBus implements EventBus {
  private readonly subscriptions: { queue: string; matchers: RegExp[]; handler: EventHandler; chain: Promise<void> }[] = [];
  readonly deadLetters: { queue: string; event: EventEnvelope; error: string }[] = [];
  private readonly logger = createLogger('event-bus');

  async publish(routingKey: string, event: EventEnvelope): Promise<void> {
    for (const sub of this.subscriptions) {
      if (!sub.matchers.some((m) => m.test(routingKey))) continue;
      sub.chain = sub.chain.then(() =>
        deliver(sub.handler, event).catch((error: unknown) => {
          this.deadLetters.push({ queue: sub.queue, event, error: String(error) });
          this.logger.error('evento enviado a la cola de mensajes muertos', { queue: sub.queue, event_id: event.id, ...errorFields(error) });
        }),
      );
    }
  }

  async subscribe(queue: string, patterns: string[], handler: EventHandler): Promise<void> {
    this.subscriptions.push({ queue, matchers: patterns.map(topicMatcher), handler, chain: Promise.resolve() });
  }

  /** Espera a que se procesen los eventos ya publicados (pruebas). */
  async drain(): Promise<void> {
    await Promise.all(this.subscriptions.map((s) => s.chain));
  }

  async close(): Promise<void> {
    await this.drain();
  }
}

/**
 * Exchange del bus. Con el broker central de la clase es `booking.events` (`RABBITMQ_EXCHANGE`), compartido con Booking
 * Prototipo y los demás grupos.
 */
export const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'atracciones.events';

/**
 * Prefijo de nuestras claves de enrutamiento y colas en un broker compartido (`RABBITMQ_PREFIX`, p. ej. `tourgirls`):
 * publicamos `tourgirls.order.OrdenPagada` y nuestras colas solo se enlazan a `tourgirls.*`, así que nunca recibimos
 * eventos de otros grupos ni chocamos con sus colas. Vacío en local.
 */
const PREFIX = process.env.RABBITMQ_PREFIX ? `${process.env.RABBITMQ_PREFIX}.` : '';
const DLX = `${PREFIX}atracciones.events.dlx`;

/** RabbitMQ: exchange topic durable, una cola durable por consumidor y su DLQ (`<cola>.dlq`). */
export class RabbitMqEventBus implements EventBus {
  private constructor(
    private readonly connection: amqp.ChannelModel,
    private readonly channel: amqp.ConfirmChannel,
    private readonly logger: Logger,
  ) {}

  static async connect(url: string, logger: Logger = createLogger('event-bus')): Promise<RabbitMqEventBus> {
    const connection = await amqp.connect(url);
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DLX, 'direct', { durable: true });
    return new RabbitMqEventBus(connection, channel, logger);
  }

  async publish(routingKey: string, event: EventEnvelope): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.channel.publish(EXCHANGE, `${PREFIX}${routingKey}`, Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: 'application/cloudevents+json',
        messageId: event.id,
        headers: { 'x-correlation-id': event.correlation_id },
      }, (error) => (error ? reject(error) : resolve()));
    });
  }

  async subscribe(name: string, patterns: string[], handler: EventHandler): Promise<void> {
    const queue = `${PREFIX}${name}`;
    await this.channel.assertQueue(`${queue}.dlq`, { durable: true });
    await this.channel.bindQueue(`${queue}.dlq`, DLX, queue);
    await this.channel.assertQueue(queue, { durable: true, arguments: { 'x-dead-letter-exchange': DLX, 'x-dead-letter-routing-key': queue } });
    for (const pattern of patterns) await this.channel.bindQueue(queue, EXCHANGE, `${PREFIX}${pattern}`);
    await this.channel.prefetch(10);
    await this.channel.consume(queue, (message) => {
      if (!message) return;
      let event: EventEnvelope;
      try {
        event = JSON.parse(message.content.toString('utf8')) as EventEnvelope;
      } catch {
        this.channel.nack(message, false, false);
        return;
      }
      deliver(handler, event)
        .then(() => this.channel.ack(message))
        .catch((error: unknown) => {
          this.logger.error('evento enviado a la DLQ', { queue, event_id: event.id, ...errorFields(error) });
          this.channel.nack(message, false, false);
        });
    });
  }

  async close(): Promise<void> {
    await this.channel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}

/** RabbitMQ si hay `RABBITMQ_URL`; si no, el bus en memoria (un solo proceso). */
export const createEventBus = async (url: string | null | undefined): Promise<EventBus> => (url ? RabbitMqEventBus.connect(url) : new InMemoryEventBus());
