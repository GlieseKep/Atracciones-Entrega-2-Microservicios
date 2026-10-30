import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { canonicalJson, errorFields, httpJson, type Logger } from '@atracciones/platform';
import type { WebhookResult } from '../../contract';
import type { ChargeRequest, PaymentGateway } from './gateway';

const ATTEMPTS = 5;
const REJECTED_CARD = '0000';

/** Firma del webhook: HMAC-SHA256 del JSON canónico, en hexadecimal. */
export const signWebhook = (body: unknown, secret: string) => createHmac('sha256', secret).update(canonicalJson(body)).digest('hex');

export function simulatedResult(request: ChargeRequest): WebhookResult {
  if (request.ultimos4 === REJECTED_CARD) return { numero: request.numero, resultado: 'RECHAZADO', motivo: 'Tarjeta rechazada por la pasarela simulada.' };
  return {
    numero: request.numero,
    resultado: 'APROBADO',
    referencia: `SIM-${randomUUID()}`,
    autorizacion: randomBytes(3).toString('hex').toUpperCase(),
  };
}

/**
 * Única pasarela del sistema, sin conexión con ningún proveedor real. Aprueba siempre, salvo con `ultimos4 = 0000`, y
 * entrega el resultado por el webhook firmado, reintentando si Payment responde `503`.
 */
export class SimulatedGateway implements PaymentGateway {
  constructor(
    private readonly webhookUrl: string,
    private readonly secret: string,
    private readonly logger: Logger,
  ) {}

  charge(request: ChargeRequest): void {
    void this.deliver(simulatedResult(request));
  }

  private async deliver(result: WebhookResult): Promise<void> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
      try {
        await httpJson(this.webhookUrl, { method: 'POST', body: result, headers: { 'x-signature': signWebhook(result, this.secret) } });
        return;
      } catch (error) {
        this.logger.warn('la pasarela simulada no pudo entregar el webhook', { numero: result.numero, attempt, ...errorFields(error) });
      }
    }
    this.logger.error('webhook perdido; Order revisa la orden colgada', { numero: result.numero });
  }
}
