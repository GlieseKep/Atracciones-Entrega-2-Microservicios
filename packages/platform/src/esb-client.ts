import { HEADERS } from './correlation';
import { httpJson } from './http';

/**
 * Cliente del ESB. Todos los componentes llaman a los servicios a través del ESB (`POST /esb/{servicio}/{operacion}`):
 * el ESB decide el protocolo (REST, gRPC o SOAP), aplica plazos y circuit breaker, y propaga el contexto.
 */
export class EsbClient {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultTimeoutMs = 8000,
  ) {}

  async call<T>(service: string, operation: string, input: object = {}, options: { timeoutMs?: number; idempotencyKey?: string } = {}): Promise<T> {
    const { body } = await httpJson<T>(`${this.baseUrl.replace(/\/$/, '')}/esb/${service}/${operation}`, {
      method: 'POST',
      body: input,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      headers: options.idempotencyKey ? { [HEADERS.idempotencyKey]: options.idempotencyKey } : {},
    });
    return body;
  }
}
