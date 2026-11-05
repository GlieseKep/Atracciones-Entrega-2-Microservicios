import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { auditApi, checkHealth, systemHealth } from '@/api/admin';
import { Badge, type BadgeTone } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { ErrorState } from '@/components/common/Feedback';
import { Select } from '@/components/common/Select';
import { env } from '@/config/env';
import { useAsync } from '@/hooks/useAsync';
import type { AuditEntry } from '@/types/admin';
import { formatDateTime } from '@/utils/dates';
import { AdminTable, Sub, type Column } from './AdminTable';
import { auditLabel } from './auditLabels';

/** Cada cuánto se refresca el estado mientras la página está abierta. */
const REFRESH_MS = 15_000;

const tone = (status: string): BadgeTone => (status === 'UP' ? 'success' : status === 'DOWN' ? 'danger' : 'warning');

const ms = (value: number) => `${value.toLocaleString('es-EC')} ms`;

/** Salud de cada servicio por el ESB (`systemHealth`) y bitácora de ms-audit, que recibe todos los eventos del bus. */
export default function AdminObservabilityPage() {
  const health = useAsync((signal) => systemHealth(signal), []);
  const gateway = useAsync((signal) => checkHealth(`${env.apiOrigin}/health`, signal), []);
  const partner = useAsync((signal) => checkHealth(`${env.apiBaseUrl}/atracciones/health`, signal), []);
  const actions = useAsync((signal) => auditApi.actions(signal), []);
  const [accion, setAccion] = useState('');
  const { retry: reloadHealth } = health;
  const { retry: reloadGateway } = gateway;
  const { retry: reloadPartner } = partner;
  const refresh = () => {
    reloadHealth();
    reloadGateway();
    reloadPartner();
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        reloadHealth();
        reloadGateway();
        reloadPartner();
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reloadHealth, reloadGateway, reloadPartner]);

  const columns: Column<AuditEntry>[] = [
    { header: 'Fecha', cell: (e) => formatDateTime(e.creado_en) },
    { header: 'Acción', cell: (e) => <span className="font-semibold">{auditLabel(e.accion)}<Sub>{e.accion}</Sub></span> },
    { header: 'Servicio', cell: (e) => e.entidad },
    { header: 'Afecta a', cell: (e) => e.entidad_id ?? '—' },
    { header: 'Usuario', cell: (e) => (e.usu_id ? `Usuario ${e.usu_id}` : <span className="text-ink-muted">Sistema</span>) },
    { header: 'Correlación', cell: (e) => <span className="font-mono text-xs">{e.correlation_id ?? '—'}</span> },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">Observabilidad</h1>
        <Button variant="secondary" size="sm" onClick={refresh} loading={health.status === 'loading'}>
          <RefreshCw size={16} aria-hidden="true" /> Actualizar
        </Button>
      </div>

      <h2 className="mt-8 text-xl">Estado de los servicios</h2>
      {health.data && <p className="text-xs text-ink-muted">Comprobado: {formatDateTime(health.data.checkedAt)} · se actualiza cada 15 s.</p>}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ServiceCard name="Gateway" status={gateway.data ? (gateway.data.ok ? 'UP' : 'DOWN') : undefined} detail={gateway.data && ms(gateway.data.latencyMs)} />
        <ServiceCard name="Partner API (contrato v3)" status={partner.data ? (partner.data.ok ? 'UP' : 'DOWN') : undefined} detail={partner.data && ms(partner.data.latencyMs)} />
        {health.data?.services.map((s) => (
          <ServiceCard
            key={s.service}
            name={s.service}
            status={s.status}
            detail={s.error ?? `${ms(s.latencyMs)}${s.databaseConnected === false ? ' · sin base de datos' : ''}`}
          />
        ))}
      </ul>
      {health.status === 'error' && !health.data && <ErrorState error={health.error} onRetry={health.retry} className="mt-4" />}

      <h2 className="mt-10 text-xl">Bitácora</h2>
      <AdminTable
        title="Bitácora"
        hideTitle
        load={(p, signal) => auditApi.list({ page: p.page, limit: p.limit, accion, desde: p.from, hasta: p.to }, signal)}
        columns={columns}
        rowKey={(e) => String(e.id)}
        dateLabel="Fecha"
        extraFilters={
          <Select
            label="Acción"
            value={accion}
            onChange={(e) => setAccion(e.target.value)}
            options={[{ value: '', label: 'Todas' }, ...(actions.data ?? []).map((a) => ({ value: a, label: auditLabel(a) }))]}
          />
        }
        extraKey={accion}
      />
    </div>
  );
}

function ServiceCard({ name, status, detail }: { name: string; status?: string; detail?: string | false }) {
  return (
    <li className="card-surface flex items-start justify-between gap-3 p-4">
      <span className="min-w-0">
        <span className="font-semibold">{name}</span>
        {detail && <Sub>{detail}</Sub>}
      </span>
      {status ? <Badge tone={tone(status)}>{status}</Badge> : <span className="skeleton h-5 w-10" />}
    </li>
  );
}
