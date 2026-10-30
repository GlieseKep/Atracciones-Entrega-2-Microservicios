import type { NextFunction, Request, Response } from 'express';

/** Muestras de latencia que se conservan para los percentiles (las más recientes). */
const LATENCY_SAMPLES = 2_000;
/** Minutos de historial de tráfico por minuto. */
const TIMELINE_MINUTES = 60;
const RECENT_ERRORS = 25;
const SLOW_ROUTES = 8;

interface RouteStats {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

export interface RecentError {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string | null;
}

export interface MetricsSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  requests: { total: number; byStatusClass: Record<string, number>; clientErrors: number; serverErrors: number };
  latencyMs: { p50: number; p95: number; p99: number; max: number; samples: number };
  /** Solicitudes y errores por minuto (los últimos 60 minutos, del más antiguo al más reciente). */
  timeline: { minute: string; requests: number; errors: number }[];
  /** Rutas con mayor latencia media. */
  routes: { route: string; count: number; errors: number; avgMs: number; maxMs: number }[];
  recentErrors: RecentError[];
  process: { node: string; memoryMb: { rss: number; heapUsed: number; heapTotal: number }; cpuSeconds: number };
}

const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
const round = (n: number) => Math.round(n * 10) / 10;
const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/**
 * Métricas HTTP en memoria del proceso (se reinician con cada despliegue o reinicio). Suficiente para el panel de
 * observabilidad; no sustituye a Application Insights ni a un backend de métricas persistente.
 */
export class RequestMetrics {
  private readonly startedAt = new Date();
  private total = 0;
  private readonly byStatusClass: Record<string, number> = {};
  private readonly latencies: number[] = [];
  private maxLatency = 0;
  private readonly perMinute = new Map<number, { requests: number; errors: number }>();
  private readonly routes = new Map<string, RouteStats>();
  private readonly errors: RecentError[] = [];

  /** Middleware de Express: mide cada solicitud al terminar la respuesta. */
  readonly middleware = (req: Request & { id?: string }, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      // Patrón de la ruta (`/internal/web/v1/atracciones/:id`) en vez de la URL concreta, para agrupar sin datos personales.
      const pattern = req.route?.path ? `${req.baseUrl ?? ''}${String(req.route.path)}` : '(sin ruta)';
      this.record(req.method, pattern, req.originalUrl.split('?')[0], res.statusCode, durationMs, req.id ?? null);
    });
    next();
  };

  record(method: string, route: string, path: string, status: number, durationMs: number, requestId: string | null): void {
    if (method === 'OPTIONS') return;
    this.total++;
    const statusClass = `${Math.floor(status / 100)}xx`;
    this.byStatusClass[statusClass] = (this.byStatusClass[statusClass] ?? 0) + 1;

    this.latencies.push(durationMs);
    if (this.latencies.length > LATENCY_SAMPLES) this.latencies.shift();
    this.maxLatency = Math.max(this.maxLatency, durationMs);

    const minute = Math.floor(Date.now() / 60_000);
    const bucket = this.perMinute.get(minute) ?? { requests: 0, errors: 0 };
    bucket.requests++;
    if (status >= 500) bucket.errors++;
    this.perMinute.set(minute, bucket);
    for (const key of this.perMinute.keys()) if (key <= minute - TIMELINE_MINUTES) this.perMinute.delete(key);

    const key = `${method} ${route}`;
    const stats = this.routes.get(key) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
    stats.count++;
    stats.totalMs += durationMs;
    stats.maxMs = Math.max(stats.maxMs, durationMs);
    if (status >= 500) stats.errors++;
    this.routes.set(key, stats);

    if (status >= 500 || status === 429) {
      this.errors.unshift({ at: new Date().toISOString(), method, path, status, durationMs: round(durationMs), requestId });
      if (this.errors.length > RECENT_ERRORS) this.errors.pop();
    }
  }

  snapshot(): MetricsSnapshot {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const nowMinute = Math.floor(Date.now() / 60_000);
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      requests: {
        total: this.total,
        byStatusClass: { ...this.byStatusClass },
        clientErrors: this.byStatusClass['4xx'] ?? 0,
        serverErrors: this.byStatusClass['5xx'] ?? 0,
      },
      latencyMs: {
        p50: round(percentile(sorted, 50)),
        p95: round(percentile(sorted, 95)),
        p99: round(percentile(sorted, 99)),
        max: round(this.maxLatency),
        samples: sorted.length,
      },
      timeline: Array.from({ length: TIMELINE_MINUTES }, (_, i) => {
        const minute = nowMinute - TIMELINE_MINUTES + 1 + i;
        const bucket = this.perMinute.get(minute);
        return { minute: new Date(minute * 60_000).toISOString(), requests: bucket?.requests ?? 0, errors: bucket?.errors ?? 0 };
      }),
      routes: [...this.routes.entries()]
        .map(([route, s]) => ({ route, count: s.count, errors: s.errors, avgMs: round(s.totalMs / s.count), maxMs: round(s.maxMs) }))
        .sort((a, b) => b.avgMs - a.avgMs)
        .slice(0, SLOW_ROUTES),
      recentErrors: [...this.errors],
      process: {
        node: process.version,
        memoryMb: { rss: mb(memory.rss), heapUsed: mb(memory.heapUsed), heapTotal: mb(memory.heapTotal) },
        cpuSeconds: round((cpu.user + cpu.system) / 1e6),
      },
    };
  }
}

export const METRICS = Symbol('METRICS');
