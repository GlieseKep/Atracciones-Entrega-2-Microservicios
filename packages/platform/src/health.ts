import type { DataSource } from 'typeorm';

/** Salud de un componente interno (`GET /health`). La Partner API la agrega en el `NodeHealthResponse` del contrato. */
export interface ServiceHealth {
  status: 'UP' | 'DOWN';
  service: string;
  database_connected: boolean | null;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}

const started = Date.now();

export const memoryUsageMb = () => Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
export const uptimeSeconds = () => Math.floor((Date.now() - started) / 1000);

/** Comprueba la base de datos del servicio con `SELECT 1` (o solo el proceso si el componente no tiene base). */
export async function checkHealth(service: string, dataSource?: DataSource | null): Promise<ServiceHealth> {
  const begin = performance.now();
  let connected: boolean | null = null;
  if (dataSource) {
    try {
      await dataSource.query('SELECT 1');
      connected = true;
    } catch {
      connected = false;
    }
  }
  return {
    status: connected === false ? 'DOWN' : 'UP',
    service,
    database_connected: connected,
    latency_ms: Math.round(performance.now() - begin),
    memory_usage_mb: memoryUsageMb(),
    uptime_seconds: uptimeSeconds(),
    timestamp: new Date().toISOString(),
  };
}

/** `NodeHealthResponse` del contrato v3, para el `GET /health` de cada microservicio. */
export interface NodeHealthResponse {
  status: 'UP' | 'DEGRADED' | 'DOWN';
  node_id: string;
  node_code: string;
  version: string;
  database_connected: boolean;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}

export interface NodeIdentity {
  nodeId: string;
  nodeCode: string;
  version: string;
}

export async function checkNodeHealth(service: string, dataSource: DataSource, node: NodeIdentity): Promise<NodeHealthResponse> {
  const health = await checkHealth(service, dataSource);
  return {
    status: health.status,
    node_id: node.nodeId,
    node_code: node.nodeCode,
    version: node.version,
    database_connected: health.database_connected === true,
    latency_ms: health.latency_ms,
    memory_usage_mb: health.memory_usage_mb,
    uptime_seconds: health.uptime_seconds,
    timestamp: health.timestamp,
  };
}
