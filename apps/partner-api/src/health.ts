import { memoryUsageMb, uptimeSeconds, type EsbClient, type EventBus, type EventBusStatus, type ServiceHealth } from '@atracciones/platform';
import type { PartnerApiConfig } from './config';

/** `NodeHealthResponse` del contrato v3, con `service` como pide la guía de socios de Booking. */
interface NodeHealthResponse {
  status: 'UP' | 'DEGRADED' | 'DOWN';
  service: string;
  node_id: string;
  node_code: string;
  url_base: string;
  version: string;
  database_connected: boolean;
  rabbitmq_connected: boolean;
  rabbitmq_status: EventBusStatus;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}

/**
 * Umbrales del semáforo de Booking (contrato, `GET /atracciones/health`). En Azure la base está en otra región que los
 * servicios, así que se pueden subir con `HEALTH_UP_MS` y `HEALTH_DOWN_MS`.
 */
const UP_LATENCY_MS = Number(process.env.HEALTH_UP_MS ?? 200);
const DOWN_LATENCY_MS = Number(process.env.HEALTH_DOWN_MS ?? 800);
const HIGH_MEMORY_MB = 1024;

/**
 * Salud agregada del nodo (plan §7.6): consulta en paralelo la salud de los servicios críticos y opcionales a través
 * del ESB y resume el semáforo: UP (todo bien y < 200 ms), DEGRADED (200–800 ms, un servicio opcional caído, memoria
 * alta o RabbitMQ caído: las ventas siguen y el outbox reintenta) y DOWN (un servicio crítico caído o > 800 ms → HTTP
 * 503). El resultado se guarda unos segundos porque Booking consulta cada 5 s.
 *
 * `database_connected` habla solo de las bases: un servicio que no responde no dice nada sobre la suya.
 */
export class NodeHealth {
  private cached: { at: number; report: NodeHealthResponse } | null = null;
  private bus: EventBus | null = null;

  constructor(
    private readonly esb: EsbClient,
    private readonly config: PartnerApiConfig,
  ) {}

  /** El bus de este proceso: su conexión dice si RabbitMQ está disponible. */
  watch(bus: EventBus): void {
    this.bus = bus;
  }

  async report(): Promise<NodeHealthResponse> {
    if (this.cached && Date.now() - this.cached.at < this.config.health.cacheMs) return this.cached.report;
    const begin = performance.now();
    const check = async (service: string) => {
      try {
        const health = await this.esb.call<ServiceHealth>(service, 'health', {}, { timeoutMs: this.config.health.timeoutMs });
        return { up: health.status === 'UP' && health.database_connected !== false, responded: true, database: health.database_connected !== false };
      } catch {
        return { up: false, responded: false, database: false };
      }
    };
    const [critical, optional] = await Promise.all([
      Promise.all(this.config.health.critical.map(check)),
      Promise.all(this.config.health.optional.map(check)),
    ]);
    const latency = Math.round(performance.now() - begin);
    const memory = memoryUsageMb();
    const criticalOk = critical.every((service) => service.up);
    const responded = [...critical, ...optional].filter((service) => service.responded);
    const rabbitmq = this.bus?.status() ?? 'IN_MEMORY';
    const status: NodeHealthResponse['status'] =
      !criticalOk || latency > DOWN_LATENCY_MS ? 'DOWN'
      : latency >= UP_LATENCY_MS || !optional.every((service) => service.up) || memory > HIGH_MEMORY_MB || rabbitmq === 'DISCONNECTED' ? 'DEGRADED'
      : 'UP';
    const report: NodeHealthResponse = {
      status,
      service: 'Atracciones',
      node_id: this.config.node.id,
      node_code: this.config.node.code,
      url_base: this.config.node.publicBaseUrl,
      version: this.config.node.version,
      database_connected: responded.length > 0 && responded.every((service) => service.database),
      rabbitmq_connected: rabbitmq === 'CONNECTED',
      rabbitmq_status: rabbitmq,
      latency_ms: latency,
      memory_usage_mb: memory,
      uptime_seconds: uptimeSeconds(),
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    this.cached = { at: Date.now(), report };
    return report;
  }
}
