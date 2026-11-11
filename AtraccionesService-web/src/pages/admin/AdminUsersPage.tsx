import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, ShieldCheck } from 'lucide-react';
import { auditApi, usersApi } from '@/api/admin';
import { requestPasswordRecovery } from '@/api/auth';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
import type { RoleName, User } from '@/types/identity';
import { errorMessage, fieldError } from '@/utils/api';
import { formatDateTime } from '@/utils/dates';
import { passwordSchema, personDocumentSchema } from '@/utils/validation';
import { AdminTable, Sub, type Column } from './AdminTable';
import { auditLabel } from './auditLabels';

const ROLES: { value: RoleName; label: string; help: string }[] = [
  { value: 'ADMIN', label: 'Administrador', help: 'Acceso completo al panel' },
  { value: 'OPERADOR', label: 'Operador', help: 'Gestiona las atracciones de su operador y hace check-in' },
  { value: 'GUIA', label: 'Guía', help: 'Hace el check-in en el punto de encuentro' },
  { value: 'CLIENTE', label: 'Cliente', help: 'Compra en el portal' },
];

const roleLabel = (rol: string) => ROLES.find((r) => r.value === rol)?.label ?? rol;

/** Usuarios de ms-identity: buscar, ver, activar o desactivar, dar o quitar roles (incluido ADMIN) y crear cuentas. */
export default function AdminUsersPage() {
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [rol, setRol] = useState<RoleName | ''>('');

  const columns: Column<User>[] = [
    {
      header: 'Usuario',
      cell: (u) => (
        <button type="button" className="text-left font-semibold hover:underline" onClick={() => setSelected(u.id)}>
          {u.nombre} {u.apellido}
          <Sub>{u.correo}</Sub>
        </button>
      ),
    },
    {
      header: 'Roles',
      cell: (u) => (
        <span className="flex flex-wrap gap-1">
          {u.roles.map((r) => (
            <Badge key={r} tone={r === 'ADMIN' ? 'brand' : 'neutral'}>
              {roleLabel(r)}
            </Badge>
          ))}
        </span>
      ),
    },
    { header: 'Estado', cell: (u) => <Badge tone={u.activo ? 'success' : 'danger'}>{u.activo ? 'Activo' : 'Desactivado'}</Badge> },
    { header: 'Correo verificado', cell: (u) => (u.verificado ? 'Sí' : 'No') },
    { header: 'Último acceso', cell: (u) => (u.ultimo_acceso ? formatDateTime(u.ultimo_acceso) : <span className="text-ink-muted">Nunca</span>) },
    {
      header: '',
      align: 'right',
      cell: (u) => (
        <Button size="sm" variant="secondary" onClick={() => setSelected(u.id)}>
          Gestionar
        </Button>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Usuarios"
        load={(p, signal) => usersApi.list({ page: p.page, limit: p.limit, q: p.search, activo: (p.status as '' | 'true' | 'false') ?? '', rol }, signal)}
        columns={columns}
        rowKey={(u) => String(u.id)}
        searchPlaceholder="Nombre, apellido o correo"
        statuses={[
          { value: 'true', label: 'Activos' },
          { value: 'false', label: 'Desactivados' },
        ]}
        extraFilters={
          <Select
            label="Rol"
            value={rol}
            onChange={(e) => setRol(e.target.value as RoleName | '')}
            options={[{ value: '', label: 'Todos' }, ...ROLES.map((r) => ({ value: r.value, label: r.label }))]}
          />
        }
        extraKey={rol}
        reloadKey={reload}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> Nuevo usuario
          </Button>
        }
      />
      {selected !== null && <UserDialog id={selected} onClose={() => setSelected(null)} onChanged={() => setReload((n) => n + 1)} />}
      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setReload((n) => n + 1);
            setSelected(id);
          }}
        />
      )}
    </>
  );
}

function UserDialog({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user: me } = useAuth();
  const notify = useUiStore((s) => s.notify);
  const user = useAsync((signal) => usersApi.get(id, signal), [id]);
  const history = useAsync((signal) => auditApi.list({ page: 1, limit: 10, entidad: 'identity', entidad_id: String(id) }, signal), [id, user.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ rol: RoleName; add: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const self = me?.id === id;

  const run = async (key: string, action: () => Promise<User>, message: string) => {
    setBusy(key);
    try {
      user.setData(await action());
      notify(message, 'success');
      onChanged();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleRole = (rol: RoleName, add: boolean) => {
    if (rol === 'ADMIN') return setConfirm({ rol, add });
    void run(rol, () => (add ? usersApi.assignRole(id, rol) : usersApi.removeRole(id, rol)), add ? `Rol ${roleLabel(rol)} asignado.` : `Rol ${roleLabel(rol)} quitado.`);
  };

  const u = user.data;
  return (
    <Modal open onClose={onClose} title={u ? `${u.nombre} ${u.apellido}` : 'Usuario'} size="lg">
      {user.status === 'error' ? (
        <ErrorState error={user.error} onRetry={user.retry} />
      ) : !u ? (
        <div className="skeleton h-64" aria-busy="true" />
      ) : (
        <div className="space-y-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <Info label="Correo" value={u.correo} />
            <Info label="Documento" value={u.documento ?? '—'} />
            <Info label="Teléfono" value={u.telefono ?? '—'} />
            <Info label="Correo verificado" value={u.verificado ? 'Sí' : 'No'} />
            <Info label="Creado" value={formatDateTime(u.creado_en)} />
            <Info label="Último acceso" value={u.ultimo_acceso ? formatDateTime(u.ultimo_acceso) : 'Nunca'} />
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Editar datos
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              loading={busy === 'recuperacion'}
              onClick={async () => {
                setBusy('recuperacion');
                try {
                  await requestPasswordRecovery(u.correo);
                  notify(`Se envió el correo para restablecer la contraseña a ${u.correo}.`, 'success');
                } catch (error) {
                  notify(errorMessage(error), 'error');
                } finally {
                  setBusy(null);
                }
              }}
            >
              Enviar correo para restablecer la contraseña
            </Button>
          </div>

          <section>
            <h3 className="text-base">Roles</h3>
            <p className="text-xs text-ink-muted">Los cambios rigen desde el próximo token del usuario (unos 30 s).</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {ROLES.map((r) => {
                const has = u.roles.includes(r.value);
                const locked = self && r.value === 'ADMIN';
                return (
                  <li key={r.value} className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
                    <span>
                      <span className="font-semibold">{r.label}</span>
                      <Sub>{locked ? 'No puedes quitarte tu propio rol de administrador' : r.help}</Sub>
                    </span>
                    <Button size="sm" variant={has ? 'secondary' : 'primary'} disabled={locked} loading={busy === r.value} onClick={() => toggleRole(r.value, !has)}>
                      {has ? 'Quitar' : 'Dar'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface p-4">
            <span>
              Cuenta <strong>{u.activo ? 'activa' : 'desactivada'}</strong>
              <Sub>{self ? 'No puedes desactivar tu propia cuenta' : 'Desactivar cierra todas sus sesiones.'}</Sub>
            </span>
            <Button
              variant={u.activo ? 'danger' : 'primary'}
              disabled={self}
              loading={busy === 'activo'}
              onClick={() => run('activo', () => usersApi.setActive(id, !u.activo), u.activo ? 'Cuenta desactivada.' : 'Cuenta reactivada.')}
            >
              {u.activo ? 'Desactivar' : 'Reactivar'}
            </Button>
          </section>

          <section>
            <h3 className="text-base">Historial</h3>
            {history.status === 'error' ? (
              <p className="mt-2 text-sm text-ink-muted">No se pudo leer la bitácora.</p>
            ) : !history.data ? (
              <div className="skeleton mt-2 h-16" />
            ) : history.data.items.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Sin cambios registrados.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {history.data.items.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {auditLabel(e.accion)}
                      {typeof e.detalle?.rol === 'string' && <strong> {roleLabel(e.detalle.rol)}</strong>}
                      <Sub>{e.usu_id ? `Por el usuario ${e.usu_id}` : 'Sistema'}</Sub>
                    </span>
                    <span className="text-ink-muted">{formatDateTime(e.creado_en)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {editing && u && (
        <EditUserDialog
          user={u}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            user.setData(updated);
            onChanged();
          }}
        />
      )}

      {confirm && u && (
        <Modal
          open
          size="sm"
          onClose={() => setConfirm(null)}
          title={confirm.add ? 'Dar rol de administrador' : 'Quitar rol de administrador'}
          footer={
            <>
              <Button variant="tertiary" onClick={() => setConfirm(null)}>
                Cancelar
              </Button>
              <Button
                variant={confirm.add ? 'primary' : 'danger'}
                onClick={() => {
                  const add = confirm.add;
                  setConfirm(null);
                  void run('ADMIN', () => (add ? usersApi.assignRole(id, 'ADMIN') : usersApi.removeRole(id, 'ADMIN')), add ? 'Ahora es administrador.' : 'Ya no es administrador.');
                }}
              >
                Confirmar
              </Button>
            </>
          }
        >
          <p className="flex items-start gap-2 text-ink-soft">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
            {confirm.add
              ? `${u.nombre} ${u.apellido} tendrá acceso completo al panel: usuarios, ventas, catálogo y configuración.`
              : `${u.nombre} ${u.apellido} perderá el acceso al panel de administración.`}
          </p>
        </Modal>
      )}
    </Modal>
  );
}

function EditUserDialog({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (user: User) => void }) {
  const notify = useUiStore((s) => s.notify);
  const [nombre, setNombre] = useState(user.nombre);
  const [apellido, setApellido] = useState(user.apellido);
  const [documento, setDocumento] = useState(user.documento ?? '');
  const [telefono, setTelefono] = useState(user.telefono ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [docError, setDocError] = useState<string | undefined>();

  const save = async () => {
    // Cuentas anteriores pueden no tener documento: si sigue vacío no se envía; si se escribe, debe ser válido.
    const keepEmpty = !user.documento && documento.trim() === '';
    const doc = keepEmpty ? null : personDocumentSchema.safeParse(documento);
    if (doc && !doc.success) return setDocError(doc.error.issues[0]?.message);
    setDocError(undefined);
    setBusy(true);
    setError(null);
    try {
      const updated = await usersApi.update(user.id, {
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        ...(doc?.success && doc.data !== user.documento ? { documento: doc.data } : {}),
        telefono: telefono.trim() || null,
      });
      notify('Datos actualizados.', 'success');
      onSaved(updated);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Editar datos"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!nombre.trim() || !apellido.trim() || (Boolean(user.documento) && !documento.trim())} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Nombre" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} error={fieldError(error, 'nombre')} />
        <Input label="Apellido" maxLength={120} value={apellido} onChange={(e) => setApellido(e.target.value)} error={fieldError(error, 'apellido')} />
        <Input
          label="Cédula o pasaporte"
          maxLength={20}
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
          help="Solo un administrador puede cambiarla."
          error={docError ?? fieldError(error, 'documento')}
        />
        <Input label="Teléfono (opcional)" maxLength={20} value={telefono} onChange={(e) => setTelefono(e.target.value)} error={fieldError(error, 'telefono')} />
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

const createSchema = z.object({
  nombre: z.string().trim().min(1, 'Indica el nombre.').max(120),
  apellido: z.string().trim().min(1, 'Indica el apellido.').max(120),
  documento: personDocumentSchema,
  correo: z.string().trim().email('Introduce un correo válido.').max(160),
  telefono: z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'De 7 a 15 dígitos, con + opcional.').optional().or(z.literal('')),
  password: passwordSchema,
});
type CreateValues = z.infer<typeof createSchema>;

/**
 * Alta desde el panel (auditoría §4.3, opción A): registro con contraseña temporal y luego los roles elegidos. La cuenta
 * recibe el correo de verificación; la persona puede cambiar la contraseña o usar "¿Olvidaste tu contraseña?".
 */
function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const notify = useUiStore((s) => s.notify);
  const [roles, setRoles] = useState<RoleName[]>([]);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({ resolver: zodResolver(createSchema), mode: 'onTouched' });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const user = await usersApi.create({ correo: v.correo.toLowerCase(), password: v.password, nombre: v.nombre, apellido: v.apellido, documento: v.documento, telefono: v.telefono || null });
      for (const rol of roles) await usersApi.assignRole(user.id, rol);
      notify('Usuario creado. Comunícale la contraseña temporal por un canal seguro.', 'success');
      onCreated(user.id);
    } catch (e) {
      setError(e);
    }
  });

  const err = (name: keyof CreateValues) => errors[name]?.message ?? fieldError(error, name);

  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo usuario"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={isSubmitting} onClick={submit}>
            Crear usuario
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre" error={err('nombre')} {...register('nombre')} />
        <Input label="Apellido" error={err('apellido')} {...register('apellido')} />
        <Input label="Cédula o pasaporte" maxLength={20} error={err('documento')} {...register('documento')} />
        <Input label="Correo" type="email" error={err('correo')} {...register('correo')} />
        <Input label="Teléfono (opcional)" type="tel" error={err('telefono')} {...register('telefono')} />
        <Input
          label="Contraseña temporal"
          type="text"
          autoComplete="off"
          className="sm:col-span-2"
          help="Entre 8 y 72 caracteres. La persona puede cambiarla después."
          error={err('password')}
          {...register('password')}
        />
        <fieldset className="sm:col-span-2">
          <legend className="field-label">Roles además de Cliente</legend>
          <div className="flex flex-wrap gap-4">
            {ROLES.filter((r) => r.value !== 'CLIENTE').map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] accent-[#C94D6B]"
                  checked={roles.includes(r.value)}
                  onChange={(e) => setRoles((list) => (e.target.checked ? [...list, r.value] : list.filter((x) => x !== r.value)))}
                />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        {error !== null && (
          <div className="sm:col-span-2">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        )}
      </form>
    </Modal>
  );
}
