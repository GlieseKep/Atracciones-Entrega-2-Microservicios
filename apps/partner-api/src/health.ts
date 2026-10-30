import { memoryUsageMb, uptimeSeconds, type EsbClient, type ServiceHealth } from '@atracciones/platform';
import type { ContractV2Schema } from '@atracciones/contracts';
import type { PartnerApiConfig } from './config';

type NodeHealthResponse = ContractV2Schema<'NodeHealthResponse'>;

/** Umbrales del semáforo de Booking (contrato, `GET /atracciones/health`). */
const UP_LATENCY_MS = 200;
const DOWN_LATENCY_MS = 800;
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
