import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, LogOut, Receipt } from 'lucide-react';
import { getMyCustomer, updateMyCustomer } from '@/api/customers';
import { getOrder } from '@/api/orders';
import { Button, ButtonLink } from '@/components/common/Button';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { BillingForm } from '@/components/profile/BillingForm';
import { ProfileCard } from '@/components/profile/ProfileCard';
import { ReservationHistory } from '@/components/profile/ReservationHistory';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/profile/StatusBadge';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { useRecentOrdersStore } from '@/stores/recentOrdersStore';
import { useUiStore } from '@/stores/uiStore';
import type { UpdateCustomerRequest } from '@/types/identity';
import { isApiError } from '@/utils/api';
import { formatDateTime } from '@/utils/dates';
import { formatMoney, shortCode } from '@/utils/formatters';
import { paths } from '@/utils/routes';

const TABS = [
  { id: 'datos', label: 'Datos personales' },
  { id: 'facturacion', label: 'Facturación' },
  { id: 'reservas', label: 'Reservas' },
  { id: 'pedidos', label: 'Pedidos y pagos' },
  { id: 'configuracion', label: 'Configuración' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'datos') as TabId;
  const { claims, user, signOut } = useAuth();

  return (
    <div className="page-container pt-8">
      <h1 className="text-3xl">Mi cuenta</h1>
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Secciones del perfil">
          <ul className="scrollbar-none flex gap-1 overflow-x-auto lg:flex-col">
            {TABS.map((t) => (
              <li key={t.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setParams({ tab: t.id })}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={`w-full rounded-sm px-4 py-2.5 text-left text-sm font-semibold transition ${
                    tab === t.id
                      ? 'bg-brand-50 text-brand-600 lg:border-l-4 lg:border-brand-500'
                      : 'hover:bg-surface'
                  }`}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-label={TABS.find((t) => t.id === tab)?.label} className="min-w-0">
          {tab === 'datos' && (
            <div className="space-y-4">
              <ProfileCard claims={claims} user={user} />
              <p className="text-sm text-ink-soft">
                Tu nombre y correo provienen de tu proveedor de identidad. Para cambiarlos, actualízalos allí.
              </p>
            </div>
          )}
          {tab === 'facturacion' && <BillingTab fallbackEmail={user?.email ?? claims?.email} />}
          {tab === 'reservas' && <ReservationHistory />}
          {tab === 'pedidos' && <OrdersTab />}
          {tab === 'configuracion' && (
            <div className="card-surface space-y-4 p-5">
              <h2 className="text-lg">Sesión</h2>
              <p className="text-sm text-ink-soft">
                La sesión se mantiene solo en memoria por seguridad: al cerrar o recargar la pestaña tendrás
                que volver a iniciar sesión.
              </p>
              {claims && (
                <div>
                  <p className="text-sm font-semibold">Permisos concedidos</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {claims.scopes.map((s) => (
                      <li key={s} className="rounded-full bg-surface px-3 py-1 font-mono text-xs">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button variant="danger" onClick={signOut}>
                <LogOut size={16} aria-hidden="true" /> Cerrar sesión
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function BillingTab({ fallbackEmail }: { fallbackEmail?: string }) {
  const customer = useAsync(
    (signal) => getMyCustomer(signal).catch((e) => (isApiError(e, 'notFound') ? null : Promise.reject(e))),
    [],
  );
  const notify = useUiStore((s) => s.notify);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (customer.status === 'error') return <ErrorState error={customer.error} onRetry={customer.retry} />;
  if (customer.status === 'loading') return <div className="skeleton h-64" aria-busy="true" />;

  const save = async (body: UpdateCustomerRequest) => {
    setSaving(true);
    setError(null);
    try {
      customer.setData(await updateMyCustomer(body));
      notify('Datos de facturación guardados.', 'success');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-surface p-5">
      <h2 className="mb-4 text-lg">Datos de facturación</h2>
      <BillingForm
        customer={customer.data}
        fallbackEmail={fallbackEmail}
        submitting={saving}
        error={error}
        onSubmit={save}
      />
    </div>
  );
}

function OrdersTab() {
  const ids = useRecentOrdersStore((s) => s.ids);
  const navigate = useNavigate();
  const [lookup, setLookup] = useState('');
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lookup.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) navigate(paths.order(lookup.trim()));
  };

  return (
    <div className="space-y-6">
      {ids.length === 0 ? (
        <EmptyState
          title="No hay pedidos recientes en este dispositivo"
          action={<ButtonLink to={paths.attractions()}>Explorar experiencias</ButtonLink>}
        >
          Los pedidos que hagas aparecerán aquí con su estado de pago.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {ids.map((id) => (
            <OrderRow key={id} id={id} />
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="card-surface flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <Input
          className="flex-1"
          label="Buscar un pedido por su identificador"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          error={lookup && !valid ? 'Introduce el identificador completo del pedido.' : undefined}
        />
        <Button type="submit" disabled={!valid}>
          Ver pedido
        </Button>
      </form>
    </div>
  );
}

function OrderRow({ id }: { id: string }) {
  const order = useAsync((signal) => getOrder(id, signal), [id]);
  if (order.status === 'loading') return <li className="skeleton h-20" />;
  if (order.status === 'error') return null;
  const o = order.data;
  return (
    <li>
      <Link
        to={paths.order(o.id)}
        className="card-surface flex items-center gap-4 p-4 transition hover:shadow-card"
      >
        <span
          className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 sm:flex"
          aria-hidden="true"
        >
          <Receipt size={22} />
        </span>
        <div className="flex-1">
          <p className="font-bold">Pedido #{shortCode(o.id)}</p>
          <p className="text-sm text-ink-soft">{formatDateTime(o.createdAt)}</p>
        </div>
        <div className="space-y-1 text-right">
          <OrderStatusBadge status={o.status} />
          {o.paymentSimulation && (
            <div>
              <PaymentStatusBadge status={o.paymentSimulation.status} />
            </div>
          )}
          <p className="font-bold">{formatMoney(o.totalAmount, o.currency)}</p>
        </div>
        <ChevronRight size={18} className="text-ink-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}
