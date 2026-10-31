import { Link } from 'react-router-dom';
import { adminApi } from '@/api/admin';
import { ErrorState } from '@/components/common/Feedback';
import { useAsync } from '@/hooks/useAsync';
import { formatMoney } from '@/utils/formatters';
import { ADMIN_SECTIONS } from './AdminLayout';

const sum = (counts: Record<string, number>, ...keys: string[]) => keys.reduce((s, k) => s + (counts[k] ?? 0), 0);

/** Indicadores generales del negocio y accesos a cada sección. */
export default function AdminDashboardPage() {
  const summary = useAsync((signal) => adminApi.summary(signal), []);
  const s = summary.data;
  const occupancy = s && s.upcoming.capacity ? Math.round((s.upcoming.reserved / s.upcoming.capacity) * 100) : 0;

  const stats = s
    ? [
        { label: 'Ingresos cobrados', value: s.revenue.length ? s.revenue.map((r) => formatMoney(r.amount, r.currency)).join(' · ') : formatMoney(0), to: '/admin/reportes' },
        { label: 'Clientes registrados', value: s.customers.toLocaleString('es-EC'), hint: `${s.activeUsers} activos`, to: '/admin/clientes' },
        {
          label: 'Reservas confirmadas',
          value: sum(s.reservationsByStatus, 'CONFIRMED').toLocaleString('es-EC'),
          hint: `${sum(s.reservationsByStatus, 'CANCELLED')} canceladas`,
          to: '/admin/reservas',
        },
        {
          label: 'Pedidos pagados',
          value: sum(s.ordersByStatus, 'PAID', 'FULFILLED').toLocaleString('es-EC'),
          hint: `${sum(s.ordersByStatus, 'PENDING_PAYMENT')} pendientes de pago`,
          to: '/admin/pedidos',
        },
        {
          label: 'Pagos rechazados o fallidos',
          value: sum(s.paymentsByStatus, 'REJECTED', 'FAILED').toLocaleString('es-EC'),
          hint: `${sum(s.paymentsByStatus, 'SETTLED', 'AUTHORIZED')} aprobados`,
          to: '/admin/pagos',
        },
        {
          label: 'Ocupación (próximos 30 días)',
          value: `${occupancy}%`,
          hint: `${s.upcoming.reserved.toLocaleString('es-EC')} de ${s.upcoming.capacity.toLocaleString('es-EC')} cupos`,
          to: '/admin/disponibilidad',
        },
        { label: 'Atracciones publicadas', value: s.attractions.toLocaleString('es-EC'), to: '/admin/catalogo' },
      ]
    : [];

  return (
    <div>
      <h1 className="text-3xl">Dashboard</h1>
      {summary.status === 'error' ? (
        <ErrorState error={summary.error} onRetry={summary.retry} className="mt-6" />
      ) : (
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!s
            ? Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton h-28" aria-busy="true" />)
            : stats.map((st) => (
                <Link key={st.label} to={st.to} className="card-surface block p-5 hover:shadow-card">
                  <dt className="text-sm text-ink-soft">{st.label}</dt>
                  <dd className="mt-1 text-2xl font-extrabold">{st.value}</dd>
                  {st.hint && <dd className="mt-1 text-xs text-ink-muted">{st.hint}</dd>}
                </Link>
              ))}
        </dl>
      )}
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
