import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { adminApi, type AdminCustomer, type AdminRole, type UserStatus } from '@/api/admin';
import { Badge, type BadgeTone } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { Modal } from '@/components/common/Modal';
import { useAsync } from '@/hooks/useAsync';
import { useUiStore } from '@/stores/uiStore';
import { errorMessage } from '@/utils/api';
import { formatDateTime } from '@/utils/dates';
import { formatMoney } from '@/utils/formatters';
import { AdminTable, Sub, type Column } from './AdminTable';

const USER_STATUS: Record<UserStatus, [string, BadgeTone]> = {
  ACTIVE: ['Activo', 'success'],
  LOCKED: ['Bloqueado', 'warning'],
  DISABLED: ['Desactivado', 'danger'],
};

const STATUS_OPTIONS = (Object.keys(USER_STATUS) as UserStatus[]).map((value) => ({ value, label: USER_STATUS[value][0] }));

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const [label, tone] = USER_STATUS[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

const columns = (open: (c: AdminCustomer) => void): Column<AdminCustomer>[] => [
  {
    header: 'Cliente',
    cell: (c) => (
      <button type="button" className="text-left font-semibold hover:underline" onClick={() => open(c)}>
        {c.name ?? 'Sin nombre'}
        <Sub>{c.email}</Sub>
      </button>
    ),
  },
  { header: 'Estado', cell: (c) => <UserStatusBadge status={c.status} /> },
  { header: 'Reservas', cell: (c) => c.reservations, align: 'right' },
  { header: 'Pedidos', cell: (c) => c.orders, align: 'right' },
  { header: 'Gastado', cell: (c) => formatMoney(c.totalSpent), align: 'right' },
  {
    header: 'Roles',
    cell: (c) =>
      c.roles.length ? (
        <div className="flex flex-wrap gap-1">
          {c.roles.map((r) => (
            <Badge key={r} tone="brand">{r}</Badge>
          ))}
        </div>
      ) : (
        <span className="text-ink-muted">—</span>
      ),
  },
  { header: 'Alta', cell: (c) => <span className="text-xs">{formatDateTime(c.createdAt)}</span> },
  { header: 'Última actividad', cell: (c) => <span className="text-xs">{c.lastActivityAt ? formatDateTime(c.lastActivityAt) : '—'}</span> },
];

/**
 * Clientes registrados en TourGirls (perfil local creado al iniciar sesión por primera vez) con sus totales.
 * `manageRoles` muestra además la asignación de roles (vista "Usuarios y roles").
 */
export default function AdminCustomersPage({ manageRoles = false }: { manageRoles?: boolean }) {
  const [selected, setSelected] = useState<AdminCustomer | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const roles = useAsync((signal) => adminApi.roles(signal), [reloadKey], manageRoles);

  return (
    <div>
      <AdminTable
        title={manageRoles ? 'Usuarios y roles' : 'Clientes'}
        load={adminApi.customers}
        columns={columns(setSelected)}
        rowKey={(c) => c.userId}
        searchPlaceholder="Nombre, correo o RUC/cédula"
        statuses={STATUS_OPTIONS}
        reloadKey={reloadKey}
      />
      {manageRoles && <RolesOverview roles={roles} />}
      {selected && (
        <CustomerDialog
          customer={selected}
          manageRoles={manageRoles}
          roles={roles.data ?? []}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setSelected(updated);
            setReloadKey((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function RolesOverview({ roles }: { roles: ReturnType<typeof useAsync<AdminRole[]>> }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl">Roles</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Los permisos locales se suman a los del token. Para que un administrador pueda entrar al panel, su correo también
        debe estar en <code>ADMIN_EMAILS</code> del servicio de autenticación (scope <code>attractions:write</code>).
      </p>
      {roles.status === 'error' ? (
        <ErrorState error={roles.error} onRetry={roles.retry} className="mt-4" />
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {(roles.data ?? []).map((r) => (
            <li key={r.id} className="card-surface p-4">
              <p className="flex items-center gap-2 font-semibold">
                <ShieldCheck size={18} className="text-brand-500" aria-hidden="true" /> {r.name}
                <span className="ml-auto text-sm font-normal text-ink-soft">{r.users} {r.users === 1 ? 'usuario' : 'usuarios'}</span>
              </p>
              {r.description && <p className="mt-1 text-sm text-ink-soft">{r.description}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {r.permissions.map((p) => (
                  <Badge key={p} tone="neutral">{p}</Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface DialogProps {
  customer: AdminCustomer;
  manageRoles: boolean;
  roles: AdminRole[];
  onClose: () => void;
  onChanged: (customer: AdminCustomer) => void;
}

function CustomerDialog({ customer, manageRoles, roles, onClose, onChanged }: DialogProps) {
  const notify = useUiStore((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<AdminCustomer>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
      notify(done, 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string][] = [
    ['Correo de la cuenta', customer.email],
    ['Nombre de facturación', customer.billingName ?? '—'],
    ['Correo de facturación', customer.billingEmail ?? '—'],
    ['Dirección', customer.billingAddress ?? '—'],
    ['RUC / cédula', customer.taxId ?? '—'],
    ['Reservas', String(customer.reservations)],
    ['Pedidos', String(customer.orders)],
    ['Total gastado', formatMoney(customer.totalSpent)],
    ['Alta', formatDateTime(customer.createdAt)],
    ['Última actividad', customer.lastActivityAt ? formatDateTime(customer.lastActivityAt) : '—'],
  ];

  return (
    <Modal open title={customer.name ?? customer.email} onClose={onClose} size="lg" footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <div className="flex items-center gap-2">
        <UserStatusBadge status={customer.status} />
        {customer.roles.map((r) => (
          <Badge key={r} tone="brand">{r}</Badge>
        ))}
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-ink-soft">{label}</dt>
            <dd className="font-semibold break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-6 font-semibold">Estado de la cuenta</h3>
      <p className="text-sm text-ink-soft">Un usuario bloqueado o desactivado no puede reservar, comprar ni pagar.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((o) => (
          <Button
            key={o.value}
            size="sm"
            variant={customer.status === o.value ? 'dark' : 'secondary'}
            disabled={busy || customer.status === o.value}
            onClick={() => run(() => adminApi.setUserStatus(customer.userId, o.value), `Estado cambiado a ${o.label.toLowerCase()}.`)}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {manageRoles && (
        <>
          <h3 className="mt-6 font-semibold">Roles</h3>
          <ul className="mt-2 space-y-2">
            {roles.map((role) => {
              const has = customer.roles.includes(role.name);
              return (
                <li key={role.id} className="flex items-center justify-between gap-3 rounded-sm border border-line px-3 py-2">
                  <span>
                    <span className="font-semibold">{role.name}</span>
                    <Sub>{role.permissions.join(', ')}</Sub>
                  </span>
                  <Button
                    size="sm"
                    variant={has ? 'danger' : 'primary'}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => (has ? adminApi.revokeRole(customer.userId, role.id) : adminApi.assignRole(customer.userId, role.id)),
                        has ? `Rol ${role.name} revocado.` : `Rol ${role.name} asignado.`,
                      )
                    }
                  >
                    {has ? 'Quitar' : 'Asignar'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
