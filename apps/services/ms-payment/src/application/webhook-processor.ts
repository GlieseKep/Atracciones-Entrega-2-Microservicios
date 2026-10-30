import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError, currentCorrelationId, newCorrelationId, type EventBus, type EventEnvelope, type EventHandler, type Logger } from '@atracciones/platform';
import type { PaymentResult, WebhookResult } from '../contract';
import { signWebhook } from '../integration/gateways/simulated-gateway';
import type { PaymentRepository } from '../persistence/payment-repository';
import type { PaymentService } from './payment-service';

export const WEBHOOK_EVENT = 'WebhookRecibido';
export const WEBHOOK_ROUTING_KEY = `payment.${WEBHOOK_EVENT}`;
export const WEBHOOK_QUEUE = 'ms-payment-webhooks';

export function assertSignature(body: unknown, signature: string | undefined, secret: string): void {
  const expected = Buffer.from(signWebhook(body, secret));
  const received = Buffer.from(signature ?? '');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw AppError.unauthorized('La firma del webhook no es válida.');
}

/** Encola el webhook. Si el bus no acepta, responde `503` y la pasarela reintenta. */
export async function enqueueWebhook(bus: EventBus, result: WebhookResult): Promise<void> {
  const event: EventEnvelope = {
    specversion: '1.0',
    id: randomUUID(),
    source: '/servicios/payment',
    type: WEBHOOK_EVENT,
    subject: result.numero,
    time: new Date().toISOString(),
    correlation_id: currentCorrelationId() ?? newCorrelationId(),
    data: { ...result },
  };
  try {
    await bus.publish(WEBHOOK_ROUTING_KEY, event);
  } catch {
    throw AppError.unavailable('No se pudo encolar el webhook.');
  }
}

const toResult = (webhook: WebhookResult): PaymentResult =>
  webhook.resultado === 'APROBADO'
    ? { aprobado: true, referencia: webhook.referencia ?? null, autorizacion: webhook.autorizacion ?? null }
    : { aprobado: false, motivo: webhook.motivo ?? 'Pago rechazado por la pasarela.' };

/** Consumidor de la cola. Un pago en estado final no cambia: un webhook repetido se ignora. */
export function webhookHandler(payments: PaymentRepository, service: PaymentService, logger: Logger): EventHandler {
  return async (event) => {
    const webhook = event.data as unknown as WebhookResult;
    const payment = await payments.findByNumber(webhook.numero);
    if (!payment) {
      logger.warn('webhook de un pago desconocido', { numero: webhook.numero });
      return;
    }
    await service.applyResult(payment.id, toResult(webhook));
  };
}
