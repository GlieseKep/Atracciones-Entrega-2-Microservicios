import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link2, Pencil, Plus } from 'lucide-react';
import { catalogApi, locationApi, pageOf } from '@/api/admin';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { useAsync } from '@/hooks/useAsync';
import { useUiStore } from '@/stores/uiStore';
import type { Guide, Operator } from '@/types/admin';
import { errorMessage, fieldError } from '@/utils/api';
import { AdminTable, Sub, useRowAction, type Column } from './AdminTable';

const TABS = [
  { id: 'guias', label: 'Guías' },
  { id: 'operadores', label: 'Operadores' },
] as const;

/**
 * Guías y operadores de ms-catalog. Un guía pertenece a un operador y no necesita cuenta en el sistema (auditoría §2.9);
 * si va a hacer el check-in con su propia cuenta, se vincula su `usu_id` y se le da el rol GUIA en Usuarios.
 */
export default function AdminGuidesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('guias');
  const operators = useAsync((signal) => catalogApi.operators(signal), []);
  return (
    <div>
      <h1 className="text-3xl">Guías y operadores</h1>
      <div role="tablist" className="mt-5 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === t.id ? 'bg-ink text-white' : 'border border-line hover:border-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-2">
        {tab === 'guias' ? <GuidesTab operators={operators.data ?? []} /> : <OperatorsTab onChanged={operators.retry} />}
      </div>
    </div>
  );
}

function GuidesTab({ operators }: { operators: Operator[] }) {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [operador, setOperador] = useState('');
  const [editing, setEditing] = useState<Guide | 'new' | null>(null);
  const { busy, run } = useRowAction(() => setReload((n) => n + 1), notify);
  const operatorName = (id: string) => operators.find((o) => o.id === id)?.nombre_comercial ?? id;

  const columns: Column<Guide>[] = [
    { header: 'Guía', cell: (g) => <span className="font-semibold">{g.nombre}<Sub>{g.codigo}</Sub></span> },
    { header: 'Credencial MINTUR', cell: (g) => g.credencial_mintur },
    { header: 'Operador', cell: (g) => operatorName(g.operador) },
    { header: 'Cuenta', cell: (g) => (g.usu_id ? `Usuario ${g.usu_id}` : <span className="text-ink-muted">Sin cuenta</span>) },
    { header: 'Estado', cell: (g) => <Badge tone={g.activo ? 'success' : 'neutral'}>{g.activo ? 'Activo' : 'Inactivo'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (g) => (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setEditing(g)} aria-label={`Editar ${g.nombre}`}>
            <Pencil size={15} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === g.codigo}
            onClick={() => run(g.codigo, () => catalogApi.updateGuide(g.codigo, { activo: !g.activo }), g.activo ? 'Guía desactivado.' : 'Guía activado.')}
          >
            {g.activo ? 'Desactivar' : 'Activar'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Guías"
        hideTitle
        load={async (p, signal) => pageOf(await catalogApi.guides({ operador, activo: (p.status as '' | 'true' | 'false') ?? '' }, signal), p.page, p.limit)}
        columns={columns}
        rowKey={(g) => g.codigo}
        statuses={[
          { value: 'true', label: 'Activos' },
          { value: 'false', label: 'Inactivos' },
        ]}
        extraFilters={
          <Select
            label="Operador"
            value={operador}
            onChange={(e) => setOperador(e.target.value)}
            options={[{ value: '', label: 'Todos' }, ...operators.map((o) => ({ value: o.id, label: o.nombre_comercial }))]}
          />
        }
        extraKey={operador}
        reloadKey={reload}
        actions={
          <Button onClick={() => setEditing('new')} disabled={operators.length === 0}>
            <Plus size={16} aria-hidden="true" /> Nuevo guía
          </Button>
        }
      />
      {editing && (
        <GuideDialog
          guide={editing === 'new' ? null : editing}
          operators={operators}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

const guideSchema = z.object({
  codigo: z.string().trim().min(1, 'Indica el código.').max(30),
  nombre: z.string().trim().min(1, 'Indica el nombre.').max(150),
  credencial_mintur: z.string().trim().min(1, 'Indica la credencial.').max(30),
  operador: z.string().min(1, 'Elige el operador.'),
  usu_id: z.string().trim().regex(/^\d*$/, 'Debe ser un número.'),
});
type GuideValues = z.infer<typeof guideSchema>;

function GuideDialog({ guide, operators, onClose, onSaved }: { guide: Guide | null; operators: Operator[]; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<GuideValues>({
    resolver: zodResolver(guideSchema),
    defaultValues: {
      codigo: guide?.codigo ?? '',
      nombre: guide?.nombre ?? '',
      credencial_mintur: guide?.credencial_mintur ?? '',
      operador: guide?.operador ?? operators[0]?.id ?? '',
      usu_id: guide?.usu_id ? String(guide.usu_id) : '',
    },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    const usuId = v.usu_id ? Number(v.usu_id) : null;
    try {
      if (guide) await catalogApi.updateGuide(guide.codigo, { nombre: v.nombre, credencial_mintur: v.credencial_mintur, usu_id: usuId });
      else await catalogApi.createGuide({ codigo: v.codigo.toUpperCase(), nombre: v.nombre, credencial_mintur: v.credencial_mintur, operador: v.operador, usu_id: usuId });
      notify('Guía guardado.', 'success');
      onSaved();
    } catch (e) {
      setError(e);
    }
  });
  const err = (name: keyof GuideValues) => errors[name]?.message ?? fieldError(error, name);

  return (
    <Modal
      open
      onClose={onClose}
      title={guide ? `Editar ${guide.nombre}` : 'Nuevo guía'}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={isSubmitting} onClick={submit}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Código" placeholder="GUIA-CARLOS-01" disabled={!!guide} error={err('codigo')} {...register('codigo')} />
        <Select
          label="Operador"
          disabled={!!guide}
          options={operators.map((o) => ({ value: o.id, label: o.nombre_comercial }))}
          error={err('operador')}
          {...register('operador')}
        />
        <Input label="Nombre" placeholder="Lic. Carlos Morales" error={err('nombre')} {...register('nombre')} />
        <Input label="Credencial MINTUR" error={err('credencial_mintur')} {...register('credencial_mintur')} />
        <Input
          label="Cuenta en el sistema (opcional)"
          className="sm:col-span-2"
          inputMode="numeric"
          placeholder="ID del usuario"
          help="Solo si el guía hará el check-in con su propia cuenta. Dale además el rol Guía en Usuarios."
          error={err('usu_id')}
          {...register('usu_id')}
        />
        {error !== null && (
          <div className="sm:col-span-2">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        )}
      </form>
    </Modal>
  );
}

function OperatorsTab({ onChanged }: { onChanged: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Operator | 'new' | null>(null);
  const [linking, setLinking] = useState<Operator | null>(null);
  const { busy, run } = useRowAction(() => {
    setReload((n) => n + 1);
    onChanged();
  }, notify);

  const columns: Column<Operator>[] = [
    { header: 'Operador', cell: (o) => <span className="font-semibold">{o.nombre_comercial}<Sub>{o.id}</Sub></span> },
    { header: 'RUC', cell: (o) => o.ruc ?? '—' },
    { header: 'Contacto', cell: (o) => <span>{o.email_soporte ?? '—'}<Sub>{o.telefono_emergencia ?? ''}</Sub></span> },
    { header: 'Estado', cell: (o) => <Badge tone={o.activo ? 'success' : 'neutral'}>{o.activo ? 'Activo' : 'Inactivo'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (o) => (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setLinking(o)} aria-label={`Vincular usuario a ${o.nombre_comercial}`}>
            <Link2 size={15} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="tertiary" onClick={() => setEditing(o)} aria-label={`Editar ${o.nombre_comercial}`}>
            <Pencil size={15} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === o.id}
            onClick={() => run(o.id, () => catalogApi.updateOperator(o.id, { activo: !o.activo }), o.activo ? 'Operador desactivado.' : 'Operador activado.')}
          >
            {o.activo ? 'Desactivar' : 'Activar'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Operadores"
        hideTitle
        load={async (p, signal) => pageOf(await catalogApi.operators(signal), p.page, p.limit)}
        columns={columns}
        rowKey={(o) => o.id}
        reloadKey={reload}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Nuevo operador
          </Button>
        }
      />
      {editing && (
        <OperatorDialog
          operator={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReload((n) => n + 1);
            onChanged();
          }}
        />
      )}
      {linking && <LinkUserDialog operator={linking} onClose={() => setLinking(null)} />}
    </>
  );
}

const operatorSchema = z.object({
  id: z.string().trim().min(1, 'Indica el código.').max(60),
  nombre_comercial: z.string().trim().min(1, 'Indica el nombre.').max(150),
  ruc: z.string().trim().regex(/^(\d{13})?$/, 'El RUC tiene 13 dígitos.'),
  email_soporte: z.string().trim().email('Correo no válido.').or(z.literal('')),
  telefono_emergencia: z.string().trim().regex(/^(\+?[0-9]{7,15})?$/, 'De 7 a 15 dígitos.'),
  direccion: z.string().trim().max(255),
  prov_id: z.coerce.number().int().min(1, 'Elige la provincia.'),
});
type OperatorValues = z.infer<typeof operatorSchema>;

function OperatorDialog({ operator, onClose, onSaved }: { operator: Operator | null; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const provinces = useAsync((signal) => locationApi.provinces(signal), []);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OperatorValues>({
    resolver: zodResolver(operatorSchema),
    values: {
      id: operator?.id ?? '',
      nombre_comercial: operator?.nombre_comercial ?? '',
      ruc: operator?.ruc ?? '',
      email_soporte: operator?.email_soporte ?? '',
      telefono_emergencia: operator?.telefono_emergencia ?? '',
      direccion: operator?.direccion ?? '',
      prov_id: operator?.prov_id ?? provinces.data?.[0]?.id ?? 0,
    },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    const body = {
      nombre_comercial: v.nombre_comercial,
      ruc: v.ruc || undefined,
      email_soporte: v.email_soporte || undefined,
      telefono_emergencia: v.telefono_emergencia || undefined,
      direccion: v.direccion || undefined,
      prov_id: v.prov_id,
    };
    try {
      if (operator) await catalogApi.updateOperator(operator.id, body);
      else await catalogApi.createOperator({ id: v.id, ...body });
      notify('Operador guardado.', 'success');
      onSaved();
    } catch (e) {
      setError(e);
    }
  });
  const err = (name: keyof OperatorValues) => errors[name]?.message ?? fieldError(error, name);

  return (
    <Modal
      open
      onClose={onClose}
      title={operator ? `Editar ${operator.nombre_comercial}` : 'Nuevo operador'}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={isSubmitting} onClick={submit}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Código" disabled={!!operator} error={err('id')} {...register('id')} />
        <Input label="Nombre comercial" error={err('nombre_comercial')} {...register('nombre_comercial')} />
        <Input label="RUC (opcional)" error={err('ruc')} {...register('ruc')} />
        <Select
          label="Provincia"
          options={(provinces.data ?? []).map((p) => ({ value: String(p.id), label: p.nombre }))}
          error={err('prov_id')}
          {...register('prov_id')}
        />
        <Input label="Correo de soporte (opcional)" type="email" error={err('email_soporte')} {...register('email_soporte')} />
        <Input label="Teléfono de emergencia (opcional)" type="tel" error={err('telefono_emergencia')} {...register('telefono_emergencia')} />
        <Input label="Dirección (opcional)" className="sm:col-span-2" error={err('direccion')} {...register('direccion')} />
        {error !== null && (
          <div className="sm:col-span-2">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Vincula una cuenta al operador. Para que gestione sus atracciones necesita además el rol OPERADOR (Usuarios). */
function LinkUserDialog({ operator, onClose }: { operator: Operator; onClose: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [usuId, setUsuId] = useState('');
  const [cargo, setCargo] = useState<'ADMIN' | 'VENDEDOR' | 'GUIA'>('ADMIN');
  const [busy, setBusy] = useState<'link' | 'unlink' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const valid = /^\d+$/.test(usuId) && Number(usuId) > 0;

  const act = async (kind: 'link' | 'unlink') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'link') await catalogApi.linkOperatorUser(operator.id, Number(usuId), cargo);
      else await catalogApi.unlinkOperatorUser(operator.id, Number(usuId));
      notify(kind === 'link' ? 'Usuario vinculado.' : 'Usuario desvinculado.', 'success');
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Usuarios de ${operator.nombre_comercial}`}
      footer={
        <>
          <Button variant="tertiary" disabled={!valid} loading={busy === 'unlink'} onClick={() => act('unlink')}>
            Desvincular
          </Button>
          <Button disabled={!valid} loading={busy === 'link'} onClick={() => act('link')}>
            Vincular
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="ID del usuario" inputMode="numeric" value={usuId} onChange={(e) => setUsuId(e.target.value.trim())} help="Lo ves en Usuarios. Debe tener el rol Operador." />
        <Select
          label="Cargo"
          value={cargo}
          onChange={(e) => setCargo(e.target.value as typeof cargo)}
          options={[
            { value: 'ADMIN', label: 'Administrador del operador' },
            { value: 'VENDEDOR', label: 'Vendedor' },
            { value: 'GUIA', label: 'Guía' },
          ]}
        />
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}
