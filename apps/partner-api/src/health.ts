import { memoryUsageMb, uptimeSeconds, type EsbClient, type ServiceHealth } from '@atracciones/platform';
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
 * del ESB y resume el semáforo: UP (todo bien y < 200 ms), DEGRADED (200–800 ms, un servicio opcional caído o memoria
 * alta) y DOWN (un servicio crítico caído o > 800 ms → HTTP 503). El resultado se guarda unos segundos porque Booking
 * consulta cada 5 s.
 */
export class NodeHealth {
  private cached: { at: number; report: NodeHealthResponse } | null = null;

  constructor(
    private readonly esb: EsbClient,
    private readonly config: PartnerApiConfig,
  ) {}

  async report(): Promise<NodeHealthResponse> {
    if (this.cached && Date.now() - this.cached.at < this.config.health.cacheMs) return this.cached.report;
    const begin = performance.now();
    const check = async (service: string) => {
      try {
        const health = await this.esb.call<ServiceHealth>(service, 'health', {}, { timeoutMs: this.config.health.timeoutMs });
        return health.status === 'UP' && health.database_connected !== false;
      } catch {
        return false;
      }
    };
    const [critical, optional] = await Promise.all([
      Promise.all(this.config.health.critical.map(check)),
      Promise.all(this.config.health.optional.map(check)),
    ]);
    const latency = Math.round(performance.now() - begin);
    const memory = memoryUsageMb();
    const criticalOk = critical.every(Boolean);
    const status: NodeHealthResponse['status'] =
      !criticalOk || latency > DOWN_LATENCY_MS ? 'DOWN'
      : latency >= UP_LATENCY_MS || !optional.every(Boolean) || memory > HIGH_MEMORY_MB ? 'DEGRADED'
      : 'UP';
    const report: NodeHealthResponse = {
      status,
      service: 'Atracciones',
      node_id: this.config.node.id,
      node_code: this.config.node.code,
      url_base: this.config.node.publicBaseUrl,
      version: this.config.node.version,
      database_connected: criticalOk,
      latency_ms: latency,
      memory_usage_mb: memory,
      uptime_seconds: uptimeSeconds(),
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    this.cached = { at: Date.now(), report };
    return report;
  }
}
