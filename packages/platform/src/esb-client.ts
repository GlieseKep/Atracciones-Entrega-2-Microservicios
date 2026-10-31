import { HEADERS } from './correlation';
import { httpJson } from './http';

/**
 * Cliente del ESB. Todos los componentes llaman a los servicios a través del ESB (`POST /esb/{servicio}/{operacion}`):
 * el ESB decide el protocolo (REST o SOAP), aplica plazos y circuit breaker, y propaga el contexto.
 *
 * El ESB está en internet en App Service, así que exige `X-Service-Token`; por defecto se toma de `SERVICE_TOKEN`.
 */
export class EsbClient {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultTimeoutMs = 8000,
    private readonly serviceToken = process.env.SERVICE_TOKEN ?? '',
  ) {}

  async call<T>(service: string, operation: string, input: object = {}, options: { timeoutMs?: number; idempotencyKey?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { 'x-service-token': this.serviceToken };
    if (options.idempotencyKey) headers[HEADERS.idempotencyKey] = options.idempotencyKey;
    const { body } = await httpJson<T>(`${this.baseUrl.replace(/\/$/, '')}/esb/${service}/${operation}`, {
      method: 'POST',
      body: input,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      headers,
    });
    return body;
  }
}
