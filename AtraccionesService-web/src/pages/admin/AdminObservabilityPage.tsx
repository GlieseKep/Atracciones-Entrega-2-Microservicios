import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminApi, checkHealth, type AdminAuditEvent, type Observability } from '@/api/admin';
import { ErrorState } from '@/components/common/Feedback';
import { env } from '@/config/env';
import { useAsync } from '@/hooks/useAsync';
import { formatDateTime } from '@/utils/dates';
import { AdminTable, Sub, type Column } from './AdminTable';

/** Cada cuánto se refrescan el estado y las métricas mientras la página está abierta. */
const REFRESH_MS = 15_000;
const API_ORIGIN = env.apiBaseUrl.replace(/\/api\/v1$/, '');

const RESOURCE_TYPES = [
  { value: 'attraction', label: 'Atracciones' },
  { value: 'availability', label: 'Disponibilidad' },
  { value: 'order', label: 'Pedidos' },
  { value: 'user', label: 'Usuarios' },
];

const ACTIONS: Record<string, string> = {
  'attraction.create': 'Atracción creada',
  'attraction.update': 'Atracción actualizada',
  'attraction.patch': 'Atracción modificada',
  'attraction.delete': 'Atracción eliminada',
  'availability.capacity_changed': 'Capacidad cambiada',
  'availability.slot_created': 'Franja creada',
  'order.cancelled': 'Pedido cancelado',
  'order.refunded': 'Reembolso total',
  'order.partially_refunded': 'Reembolso parcial',
  'user.status_changed': 'Estado de usuario cambiado',
  'user.role_assigned': 'Rol asignado',
  'user.role_revoked': 'Rol revocado',
};

const auditColumns: Column<AdminAuditEvent>[] = [
  { header: 'Fecha', cell: (e) => <span className="text-xs">{formatDateTime(e.createdAt)}</span> },
  {
    header: 'Acción',
    cell: (e) => (
      <>
        {ACTIONS[e.action] ?? e.action}
        <Sub>{e.action}</Sub>
      </>
    ),
  },
  {
    header: 'Recurso',
    cell: (e) => (
      <>
        {RESOURCE_TYPES.find((t) => t.value === e.resourceType)?.label ?? e.resourceType}
        <Sub>
          <span className="font-mono">{e.resourceId}</span>
        </Sub>
      </>
    ),
  },
  {
    header: 'Responsable',
    cell: (e) => e.actorEmail ?? <span className="font-mono text-xs">{e.actorSubject}</span>,
  },
  { header: 'Detalle', cell: (e) => e.reason ?? <span className="text-ink-muted">—</span> },
];

const ms = (value: number) => `${value.toLocaleString('es-EC', { maximumFractionDigits: 1 })} ms`;

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

/**
 * Observabilidad: salud de los servicios, métricas HTTP del API desde su último arranque, errores recientes y el
 * registro de auditoría de los cambios hechos desde el panel.
 */
export default function AdminObservabilityPage() {
  const metrics = useAsync((signal) => adminApi.observability(signal), []);
  const api = useAsync((signal) => checkHealth(`${API_ORIGIN}/health`, signal), []);
  const auth = useAsync((signal) => checkHealth(`${env.authUrl}/health`, signal), []);
  const { retry: reloadMetrics } = metrics;
  const { retry: reloadApi } = api;
  const { retry: reloadAuth } = auth;
  const refresh = () => {
    reloadMetrics();
    reloadApi();
    reloadAuth();
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        reloadMetrics();
        reloadApi();
        reloadAuth();
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reloadMetrics, reloadApi, reloadAuth]);

  const m = metrics.data;
  const loading = metrics.status === 'loading' || api.status === 'loading' || auth.status === 'loading';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">Observabilidad</h1>
        <div className="flex items-center gap-3 text-sm text-ink-soft">
          {m && (
            <span aria-live="polite">Actualizado {new Date(m.checkedAt).toLocaleTimeString('es-EC')}</span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-semibold text-ink hover:bg-surface disabled:opacity-60"
          >
            <RefreshCw size={16} aria-hidden="true" className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Se actualiza cada {REFRESH_MS / 1000} s. Las métricas del API se reinician cuando el servicio se
        reinicia o se despliega.
      </p>

      <h2 className="mt-8 text-xl">Estado de los servicios</h2>
      <ul className="mt-4 grid gap-4 sm:grid-cols-3">
        <ServiceCard
          name="API de atracciones"
          ok={api.data?.ok}
          detail={api.data && ms(api.data.latencyMs)}
        />
        <ServiceCard
          name="Base de datos"
          ok={m ? m.database.status === 'ok' : metrics.status === 'error' ? false : undefined}
          detail={
            m ? (m.database.latencyMs !== null ? ms(m.database.latencyMs) : m.database.error) : undefined
          }
        />
        <ServiceCard
          name="Servicio de autenticación"
          ok={auth.data?.ok}
          detail={auth.data && ms(auth.data.latencyMs)}
        />
      </ul>

      {metrics.status === 'error' && !m ? (
        <ErrorState error={metrics.error} onRetry={metrics.retry} className="mt-8" />
      ) : !m ? (
        <div className="skeleton mt-8 h-72" aria-busy="true" />
      ) : (
        <Metrics m={m} />
      )}

      <div className="mt-12">
        <AdminTable
          title="Registro de auditoría"
          load={adminApi.audit}
          columns={auditColumns}
          rowKey={(e) => e.id}
          searchPlaceholder="Acción, recurso, motivo o correo"
          statuses={RESOURCE_TYPES}
          statusLabel="Recurso"
          dateLabel="Fecha"
        />
      </div>
    </div>
  );
}

function ServiceCard({
  name,
  ok,
  detail,
}: {
  name: string;
  ok: boolean | undefined;
  detail?: string | null;
}) {
  const [label, dot] =
    ok === undefined
      ? ['Comprobando…', 'bg-ink-muted']
      : ok
        ? ['Operativo', 'bg-success']
        : ['Sin respuesta', 'bg-danger'];
  return (
    <li className="card-surface p-5">
      <p className="text-sm text-ink-soft">{name}</p>
      <p className="mt-1 flex items-center gap-2 text-lg font-extrabold">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" /> {label}
      </p>
      {detail && <p className="mt-1 break-words text-xs text-ink-muted">{detail}</p>}
    </li>
  );
}

function Metrics({ m }: { m: Observability }) {
  const errorRate = m.requests.total ? (m.requests.serverErrors / m.requests.total) * 100 : 0;
  const lastHour = m.timeline.reduce((s, t) => s + t.requests, 0);
  const stats: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Tiempo activo',
      value: formatUptime(m.uptimeSeconds),
      hint: `Desde ${formatDateTime(m.startedAt)}`,
    },
    {
      label: 'Solicitudes atendidas',
      value: m.requests.total.toLocaleString('es-EC'),
      hint: `${lastHour.toLocaleString('es-EC')} en la última hora`,
    },
    {
      label: 'Errores del servidor (5xx)',
      value: `${errorRate.toLocaleString('es-EC', { maximumFractionDigits: 2 })}%`,
      hint: `${m.requests.serverErrors} errores · ${m.requests.clientErrors} rechazos 4xx`,
    },
    {
      label: 'Latencia p95',
      value: ms(m.latencyMs.p95),
      hint: `p50 ${ms(m.latencyMs.p50)} · p99 ${ms(m.latencyMs.p99)}`,
    },
    {
      label: 'Memoria del proceso',
      value: `${m.process.memoryMb.rss.toLocaleString('es-EC')} MB`,
      hint: `Heap ${m.process.memoryMb.heapUsed} de ${m.process.memoryMb.heapTotal} MB · Node ${m.process.node}`,
    },
  ];

  return (
    <>
      <h2 className="mt-10 text-xl">Métricas del API</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="card-surface p-5">
            <dt className="text-sm text-ink-soft">{s.label}</dt>
            <dd className="mt-1 text-2xl font-extrabold">{s.value}</dd>
            {s.hint && <dd className="mt-1 text-xs text-ink-muted">{s.hint}</dd>}
          </div>
        ))}
      </dl>

      <Panel
        title="Tráfico de la última hora"
        subtitle="Solicitudes por minuto; en rojo, las que terminaron en error 5xx."
      >
        <Timeline timeline={m.timeline} />
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Rutas más lentas" subtitle="Latencia media desde el último arranque.">
          {m.routes.length === 0 ? (
            <p className="text-sm text-ink-muted">Todavía no hay solicitudes registradas.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {m.routes.map((r) => (
                <li key={r.route}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-xs" title={r.route}>
                      {r.route}
                    </span>
                    <span className="shrink-0 font-semibold">{ms(r.avgMs)}</span>
                  </div>
                  <span className="block text-xs text-ink-muted">
                    {r.count.toLocaleString('es-EC')} solicitudes · máx. {ms(r.maxMs)}
                    {r.errors > 0 && <span className="text-danger"> · {r.errors} errores</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Errores recientes"
          subtitle="Respuestas 5xx y 429 (límite de solicitudes); el ID permite buscar el error en los logs."
        >
          {m.recentErrors.length === 0 ? (
            <p className="text-sm text-ink-muted">Sin errores desde el último arranque.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {m.recentErrors.map((e, i) => (
                <li key={`${e.at}-${i}`} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-xs">
                      {e.method} {e.path}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${e.status >= 500 ? 'bg-danger/10 text-danger' : 'bg-brand-50 text-brand-600'}`}
                    >
                      {e.status}
                    </span>
                  </div>
                  <span className="block text-xs text-ink-muted">
                    {formatDateTime(e.at)} · {ms(e.durationMs)}
                    {e.requestId && <span className="font-mono"> · {e.requestId}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="card-surface mt-6 p-5">
      <h3 className="text-lg">{title}</h3>
      <p className="text-xs text-ink-muted">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Timeline({ timeline }: { timeline: Observability['timeline'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...timeline.map((t) => t.requests));
  const point = hover !== null ? timeline[hover] : null;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <p className="h-5 text-xs text-ink-soft" aria-live="polite">
        {point
          ? `${time(point.minute)} · ${point.requests} solicitudes${point.errors ? ` · ${point.errors} errores` : ''}`
          : `Máximo ${max} solicitudes por minuto`}
      </p>
      <div
        className="mt-2 flex h-32 items-end gap-px"
        role="img"
        aria-label={`Solicitudes por minuto en la última hora; máximo ${max}.`}
        onMouseLeave={() => setHover(null)}
      >
        {timeline.map((t, i) => (
          <div
            key={t.minute}
            className="flex h-full flex-1 flex-col justify-end"
            onMouseEnter={() => setHover(i)}
          >
            <div
              className={`flex flex-col justify-end rounded-t-sm ${hover === i ? 'bg-brand-600' : 'bg-brand-400'}`}
              style={{ height: `${(t.requests / max) * 100}%` }}
            >
              {t.errors > 0 && (
                <div
                  className="rounded-t-sm bg-danger"
                  style={{ height: `${(t.errors / t.requests) * 100}%` }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-muted">
        <span>{time(timeline[0].minute)}</span>
        <span>Ahora</span>
      </div>
    </div>
  );
}
