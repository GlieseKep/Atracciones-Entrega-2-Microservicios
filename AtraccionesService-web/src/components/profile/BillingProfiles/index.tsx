import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { createBillingProfile, deleteBillingProfile, listBillingProfiles, markPrincipalBillingProfile, replaceBillingProfile } from '@/api/billing';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert, EmptyState, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { useAsync } from '@/hooks/useAsync';
import { useUiStore } from '@/stores/uiStore';
import type { BillingProfile, BillingProfileInput } from '@/types/billing';
import { errorMessage, fieldError } from '@/utils/api';
import { billingProfileSchema, type BillingProfileValues } from '@/utils/validation';

const ID_TYPES = [
  { value: 'CEDULA', label: 'Cédula' },
  { value: 'RUC', label: 'RUC' },
  { value: 'PASAPORTE', label: 'Pasaporte' },
  { value: 'CONSUMIDOR_FINAL', label: 'Consumidor final' },
];

const idLabel = (tipo: string) => ID_TYPES.find((t) => t.value === tipo)?.label ?? tipo;

/** Perfiles de facturación (ms-billing-profile). La factura de cada compra usa el principal. */
export function BillingProfiles({ fallbackEmail }: { fallbackEmail?: string }) {
  const profiles = useAsync((signal) => listBillingProfiles(signal), []);
  const notify = useUiStore((s) => s.notify);
  const [editing, setEditing] = useState<BillingProfile | 'new' | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const act = async (id: number, action: () => Promise<unknown>, message: string) => {
    setBusy(id);
    setActionError(null);
    try {
      await action();
      notify(message, 'success');
      profiles.retry();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  };

  if (profiles.status === 'error') return <ErrorState error={profiles.error} onRetry={profiles.retry} />;
  if (!profiles.data) return <div className="skeleton h-48" aria-busy="true" />;
  const items = profiles.data.filter((p) => p.activo !== false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">La factura electrónica de tus compras se emite con el perfil principal; sin perfiles, a consumidor final.</p>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden="true" /> Añadir perfil
        </Button>
      </div>
      {actionError !== null && <Alert tone="error">{errorMessage(actionError)}</Alert>}
      {items.length === 0 ? (
        <EmptyState title="Aún no tienes datos de facturación">Añade tu cédula o RUC para recibir facturas a tu nombre.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.id} className="card-surface flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {p.razon_social} {p.es_principal && <Badge tone="brand">Principal</Badge>}
                </p>
                <p className="text-sm text-ink-soft">
                  {idLabel(p.tipo_identificacion)} {p.identificacion} · {p.correo}
                  {p.telefono ? ` · ${p.telefono}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                {!p.es_principal && (
                  <Button variant="tertiary" size="sm" loading={busy === p.id} onClick={() => act(p.id, () => markPrincipalBillingProfile(p.id), 'Perfil principal actualizado.')}>
                    <Star size={16} aria-hidden="true" /> Principal
                  </Button>
                )}
                <Button variant="tertiary" size="sm" onClick={() => setEditing(p)} aria-label={`Editar ${p.razon_social}`}>
                  <Pencil size={16} aria-hidden="true" />
                </Button>
                <Button variant="tertiary" size="sm" onClick={() => act(p.id, () => deleteBillingProfile(p.id), 'Perfil eliminado.')} aria-label={`Eliminar ${p.razon_social}`}>
                  <Trash2 size={16} aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ProfileDialog
          profile={editing === 'new' ? null : editing}
          first={items.length === 0}
          fallbackEmail={fallbackEmail}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            profiles.retry();
          }}
        />
      )}
    </div>
  );
}

function ProfileDialog({
  profile,
  first,
  fallbackEmail,
  onClose,
  onSaved,
}: {
  profile: BillingProfile | null;
  first: boolean;
  fallbackEmail?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useUiStore((s) => s.notify);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BillingProfileValues>({
    resolver: zodResolver(billingProfileSchema),
    mode: 'onTouched',
    defaultValues: {
      tipo_identificacion: profile?.tipo_identificacion ?? 'CEDULA',
      identificacion: profile?.identificacion ?? '',
      razon_social: profile?.razon_social ?? '',
      correo: profile?.correo ?? fallbackEmail ?? '',
      telefono: profile?.telefono ?? '',
      es_principal: profile?.es_principal ?? first,
    },
  });
  const finalConsumer = watch('tipo_identificacion') === 'CONSUMIDOR_FINAL';

  const submit = handleSubmit(async (v) => {
    setError(null);
    const body: BillingProfileInput = { ...v, telefono: v.telefono || null };
    try {
      if (profile) await replaceBillingProfile(profile.id, body);
      else await createBillingProfile(body);
      notify('Datos de facturación guardados.', 'success');
      onSaved();
    } catch (e) {
      setError(e);
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={profile ? 'Editar datos de facturación' : 'Nuevos datos de facturación'}
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
        <Select label="Tipo de identificación" options={ID_TYPES} {...register('tipo_identificacion')} />
        <Input
          label="Identificación"
          placeholder={finalConsumer ? '9999999999999' : undefined}
          error={errors.identificacion?.message ?? fieldError(error, 'identificacion')}
          {...register('identificacion')}
        />
        <Input
          label="Nombre o razón social"
          className="sm:col-span-2"
          error={errors.razon_social?.message ?? fieldError(error, 'razon_social')}
          {...register('razon_social')}
        />
        <Input label="Correo" type="email" error={errors.correo?.message ?? fieldError(error, 'correo')} {...register('correo')} />
        <Input label="Teléfono (opcional)" type="tel" error={errors.telefono?.message ?? fieldError(error, 'telefono')} {...register('telefono')} />
        <label className="flex items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" className="h-[18px] w-[18px] accent-[#C94D6B]" {...register('es_principal')} /> Usar como perfil principal
        </label>
        {error !== null && (
          <div className="sm:col-span-2">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        )}
      </form>
    </Modal>
  );
}
