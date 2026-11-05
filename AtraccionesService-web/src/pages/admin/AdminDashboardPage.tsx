import { Link } from 'react-router-dom';
import { catalogApi, operationsApi, supportApi, systemHealth, usersApi } from '@/api/admin';
import { Badge } from '@/components/common/Badge';
import { useAsync } from '@/hooks/useAsync';
import { ADMIN_SECTIONS } from './AdminLayout';

const one = { page: 1, limit: 1 };

/** Total de un listado; `null` si ese servicio no respondió (el resto del tablero sigue funcionando). */
const countOf = (load: Promise<{ total: number }>) => load.then((r) => r.total).catch(() => null);

const show = (value: number | null) => (value === null ? 'No disponible' : value.toLocaleString('es-EC'));

/** Indicadores con los totales de cada servicio: no hay un servicio de agregados. */
export default function AdminDashboardPage() {
  const counts = useAsync(
    async (signal) => {
      const [users, published, confirmed, cancelled, paidOrders, createdOrders, approved, rejected, pending, unread] = await Promise.all([
        countOf(usersApi.list(one, signal)),
        countOf(catalogApi.list({ ...one, estado: 'PUBLICADA' }, signal)),
        countOf(operationsApi.reservations({ ...one, estado: 'CONFIRMED' }, signal)),
        countOf(operationsApi.reservations({ ...one, estado: 'CANCELLED' }, signal)),
        countOf(operationsApi.orders({ ...one, estado: 'PAGADA' }, signal)),
        countOf(operationsApi.orders({ ...one, estado: 'CREADA' }, signal)),
        countOf(operationsApi.payments({ ...one, estado: 'APROBADO' }, signal)),
        countOf(operationsApi.payments({ ...one, estado: 'RECHAZADO' }, signal)),
        countOf(operationsApi.payments({ ...one, estado: 'PENDIENTE' }, signal)),
        countOf(supportApi.list({ ...one, leido: 'false' }, signal)),
      ]);
      return { users, published, confirmed, cancelled, paidOrders, createdOrders, approved, rejected, pending, unread };
    },
    [],
  );
  const health = useAsync((signal) => systemHealth(signal), []);
  const c = counts.data;

  const stats = c
    ? [
        { label: 'Usuarios registrados', value: show(c.users), to: '/admin/usuarios' },
        { label: 'Atracciones publicadas', value: show(c.published), to: '/admin/catalogo' },
        { label: 'Reservas confirmadas', value: show(c.confirmed), hint: `${show(c.cancelled)} canceladas`, to: '/admin/reservas' },
        { label: 'Pedidos pagados', value: show(c.paidOrders), hint: `${show(c.createdOrders)} sin pagar`, to: '/admin/pedidos' },
        { label: 'Pagos aprobados', value: show(c.approved), hint: `${show(c.rejected)} rechazados · ${show(c.pending)} pendientes`, to: '/admin/pagos' },
        { label: 'Mensajes sin leer', value: show(c.unread), to: '/admin/mensajes' },
      ]
    : [];

  const down = health.data?.services.filter((s) => s.status !== 'UP') ?? [];

  return (
    <div>
      <h1 className="text-3xl">Dashboard</h1>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {!c
          ? Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-28" aria-busy="true" />)
          : stats.map((st) => (
              <Link key={st.label} to={st.to} className="card-surface block p-5 hover:shadow-card">
                <dt className="text-sm text-ink-soft">{st.label}</dt>
                <dd className="mt-1 text-2xl font-extrabold">{st.value}</dd>
                {st.hint && <dd className="mt-1 text-xs text-ink-muted">{st.hint}</dd>}
              </Link>
            ))}
        <Link to="/admin/observabilidad" className="card-surface block p-5 hover:shadow-card">
          <dt className="text-sm text-ink-soft">Estado del sistema</dt>
          <dd className="mt-2">
            {health.status === 'error' ? (
              <Badge tone="danger">No disponible</Badge>
            ) : !health.data ? (
              <span className="skeleton inline-block h-6 w-24" />
            ) : (
              <Badge tone={health.data.status === 'UP' ? 'success' : health.data.status === 'DOWN' ? 'danger' : 'warning'}>{health.data.status}</Badge>
            )}
          </dd>
          {down.length > 0 && <dd className="mt-2 text-xs text-danger">Con problemas: {down.map((s) => s.service).join(', ')}</dd>}
        </Link>
      </dl>

      <h2 className="mt-10 text-xl">Secciones</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ADMIN_SECTIONS.slice(1).map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="card-surface flex items-center gap-3 p-4 hover:shadow-card">
              <Icon size={22} className="text-brand-500" aria-hidden="true" />
              <span className="flex-1 font-semibold">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
