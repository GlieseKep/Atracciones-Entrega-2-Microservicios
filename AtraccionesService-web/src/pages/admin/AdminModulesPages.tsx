import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Copy, KeyRound, Pencil, Plus } from 'lucide-react';
import { apiClientsApi, couponsApi, operationsApi, pageOf, reviewsApi, supportApi } from '@/api/admin';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { Input, TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Rating } from '@/components/common/Rating';
import { Select } from '@/components/common/Select';
import { useAsync } from '@/hooks/useAsync';
import { useUiStore } from '@/stores/uiStore';
import type { AdminReview, ApiClient, ContactMessage, Coupon, CreatedApiClient } from '@/types/admin';
import type { Invoice } from '@/types/order';
import { errorMessage, fieldError } from '@/utils/api';
import { formatDate, formatDateTime, today } from '@/utils/dates';
import { formatMoney } from '@/utils/formatters';
import { AdminTable, Sub, useRowAction, type Column } from './AdminTable';

type BoolFilter = '' | 'true' | 'false';

/** Moderación de ms-review. Las reseñas anónimas quedan ocultas hasta aprobarlas. */
export function AdminReviewsPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const { busy, run } = useRowAction(() => setReload((n) => n + 1), notify);

  const columns: Column<AdminReview>[] = [
    { header: 'Autor', cell: (r) => <span className="font-semibold">{r.autor_nombre}<Sub>{r.anonima ? 'Anónima' : 'Con cuenta'} · atracción #{r.atr_id}</Sub></span> },
    { header: 'Nota', cell: (r) => <Rating score={r.puntuacion} showScore /> },
    { header: 'Comentario', cell: (r) => <span className="line-clamp-3 max-w-md">{r.comentario}</span> },
    { header: 'Fecha', cell: (r) => formatDateTime(r.creado_en) },
    { header: 'Estado', cell: (r) => <Badge tone={r.visible ? 'success' : 'warning'}>{r.visible ? 'Visible' : 'Oculta'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (r) => (
        <Button size="sm" variant="secondary" loading={busy === String(r.id)} onClick={() => run(String(r.id), () => reviewsApi.setVisible(r.id, !r.visible), r.visible ? 'Reseña ocultada.' : 'Reseña publicada.')}>
          {r.visible ? 'Ocultar' : 'Publicar'}
        </Button>
      ),
    },
  ];

  return (
    <AdminTable
      title="Reseñas"
      load={(p, signal) => reviewsApi.list({ page: p.page, limit: p.limit, visible: (p.status as BoolFilter) ?? '' }, signal)}
      columns={columns}
      rowKey={(r) => String(r.id)}
      statuses={[
        { value: 'false', label: 'Ocultas' },
        { value: 'true', label: 'Visibles' },
      ]}
      reloadKey={reload}
    />
  );
}

/** Cupones del portal y acuerdo de promociones con Booking (ms-coupon). */
export function AdminCouponsPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const { busy, run } = useRowAction(() => setReload((n) => n + 1), notify);

  const columns: Column<Coupon>[] = [
    { header: 'Código', cell: (c) => <span className="font-mono font-semibold">{c.code}</span> },
    { header: 'Descuento', cell: (c) => (c.type === 'PORCENTAJE' ? `${c.value}%` : formatMoney(c.value)) },
    { header: 'Vigencia', cell: (c) => `${formatDate(c.start_date)} — ${c.end_date ? formatDate(c.end_date) : 'sin fin'}` },
    { header: 'Usos máximos', cell: (c) => c.max_uses ?? 'Sin límite' },
    { header: 'Estado', cell: (c) => <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Activo' : 'Inactivo'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (c) => (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setEditing(c)} aria-label={`Editar ${c.code}`}>
            <Pencil size={15} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="secondary" loading={busy === c.code} onClick={() => run(c.code, () => couponsApi.update(c.code, { active: !c.active }), c.active ? 'Cupón desactivado.' : 'Cupón activado.')}>
            {c.active ? 'Desactivar' : 'Activar'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Cupones"
        load={(p, signal) => couponsApi.list({ page: p.page, limit: p.limit, code: p.search?.toUpperCase(), active: (p.status as BoolFilter) ?? '' }, signal)}
        columns={columns}
        rowKey={(c) => c.code}
        searchPlaceholder="Código"
        statuses={[
          { value: 'true', label: 'Activos' },
          { value: 'false', label: 'Inactivos' },
        ]}
        reloadKey={reload}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Nuevo cupón
          </Button>
        }
      />
      <AgreementCard />
      {editing && (
        <CouponDialog
          coupon={editing === 'new' ? null : editing}
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

const couponSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'De 3 a 30 letras, dígitos, guion o guion bajo.'),
    type: z.enum(['PORCENTAJE', 'FIJO']),
    value: z.coerce.number({ invalid_type_error: 'Indica un número.' }).positive('Debe ser mayor que 0.'),
    start_date: z.string().min(1, 'Indica la fecha.'),
    end_date: z.string(),
    max_uses: z.string().trim().regex(/^\d*$/, 'Debe ser un entero.'),
  })
  .refine((v) => v.type !== 'PORCENTAJE' || v.value <= 100, { path: ['value'], message: 'Máximo 100%.' })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, { path: ['end_date'], message: 'No puede ser anterior al inicio.' });
type CouponValues = z.infer<typeof couponSchema>;

/** Al editar, el código no cambia. Un tipo o valor nuevo rige para las compras siguientes. */
function CouponDialog({ coupon, onClose, onSaved }: { coupon: Coupon | null; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CouponValues>({
    resolver: zodResolver(couponSchema),
    defaultValues: coupon
      ? { code: coupon.code, type: coupon.type, value: coupon.value, start_date: coupon.start_date, end_date: coupon.end_date ?? '', max_uses: coupon.max_uses === null ? '' : String(coupon.max_uses) }
      : { type: 'PORCENTAJE', start_date: today(), end_date: '', max_uses: '' },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const data = { type: v.type, value: v.value, start_date: v.start_date, end_date: v.end_date || null, max_uses: v.max_uses ? Number(v.max_uses) : null };
      if (coupon) await couponsApi.update(coupon.code, data);
      else await couponsApi.create({ code: v.code, ...data, active: true });
      notify(coupon ? 'Cupón actualizado.' : 'Cupón creado.', 'success');
      onSaved();
    } catch (e) {
      setError(e);
    }
  });
  const err = (name: keyof CouponValues) => errors[name]?.message ?? fieldError(error, name);

  return (
    <Modal
      open
      onClose={onClose}
      title={coupon ? `Editar ${coupon.code}` : 'Nuevo cupón'}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Cancelar</Button>
          <Button loading={isSubmitting} onClick={submit}>{coupon ? 'Guardar' : 'Crear'}</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Código" disabled={!!coupon} error={err('code')} {...register('code')} />
        <Select
          label="Tipo"
          options={[
            { value: 'PORCENTAJE', label: 'Porcentaje' },
            { value: 'FIJO', label: 'Monto fijo (US$)' },
          ]}
          {...register('type')}
        />
        <Input label="Valor" inputMode="decimal" error={err('value')} {...register('value')} />
        <Input label="Usos máximos (opcional)" inputMode="numeric" error={err('max_uses')} {...register('max_uses')} />
        <Input label="Desde" type="date" error={err('start_date')} {...register('start_date')} />
        <Input label="Hasta (opcional)" type="date" error={err('end_date')} {...register('end_date')} />
        {error !== null && (
          <div className="sm:col-span-2">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        )}
      </form>
    </Modal>
  );
}

const agreementSchema = z.object({
  permite_promociones: z.boolean(),
  porcentaje_descuento_maximo: z.coerce.number({ invalid_type_error: 'Indica un número.' }).min(0, 'Entre 0 y 50.').max(50, 'Entre 0 y 50.'),
  destinos: z.string(),
  vigencia_hasta: z.string().min(1, 'Indica la fecha.'),
  condiciones_combo: z.string().trim(),
});
type AgreementValues = z.infer<typeof agreementSchema>;

/** Acuerdo de promociones que Booking consulta en `/atracciones/promociones/contrato`. */
function AgreementCard() {
  const notify = useUiStore((s) => s.notify);
  const agreement = useAsync((signal) => couponsApi.agreement(signal), []);
  const [error, setError] = useState<unknown>(null);
  const a = agreement.data;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AgreementValues>({
    resolver: zodResolver(agreementSchema),
    values: {
      permite_promociones: a?.permite_promociones ?? false,
      porcentaje_descuento_maximo: a?.porcentaje_descuento_maximo ?? 0,
      destinos: (a?.destinos_habilitados ?? []).join(', '),
      vigencia_hasta: a?.vigencia_hasta?.slice(0, 10) ?? '',
      condiciones_combo: a?.condiciones_combo ?? '',
    },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      agreement.setData(
        await couponsApi.updateAgreement({
          permite_promociones: v.permite_promociones,
          porcentaje_descuento_maximo: v.porcentaje_descuento_maximo,
          destinos_habilitados: v.destinos.split(',').map((d) => d.trim()).filter(Boolean),
          vigencia_hasta: v.vigencia_hasta,
          ...(v.condiciones_combo ? { condiciones_combo: v.condiciones_combo } : {}),
        }),
      );
      notify('Acuerdo actualizado.', 'success');
    } catch (e) {
      setError(e);
    }
  });

  return (
    <section className="mt-10" aria-labelledby="agreement-title">
      <h2 id="agreement-title" className="text-xl">Acuerdo de promociones con Booking</h2>
      {agreement.status === 'error' ? (
        <ErrorState error={agreement.error} onRetry={agreement.retry} className="mt-4" />
      ) : !a ? (
        <div className="skeleton mt-4 h-40" aria-busy="true" />
      ) : (
        <form onSubmit={submit} noValidate className="card-surface mt-4 grid gap-4 p-5 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-[18px] w-[18px] accent-[#C94D6B]" {...register('permite_promociones')} /> Permitir promociones en paquetes
          </label>
          <Input label="Descuento máximo (%)" inputMode="decimal" error={errors.porcentaje_descuento_maximo?.message} {...register('porcentaje_descuento_maximo')} />
          <Input label="Vigente hasta" type="date" error={errors.vigencia_hasta?.message} {...register('vigencia_hasta')} />
          <Input label="Destinos habilitados" className="sm:col-span-2" help="Separados por comas." {...register('destinos')} />
          <TextArea label="Condiciones (opcional)" className="sm:col-span-2" {...register('condiciones_combo')} />
          {error !== null && (
            <div className="sm:col-span-2">
              <Alert tone="error">{errorMessage(error)}</Alert>
            </div>
          )}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={isSubmitting}>Guardar acuerdo</Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Mensajes del formulario de contacto (ms-support). */
export function AdminMessagesPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<ContactMessage | null>(null);
  const { busy, run } = useRowAction(() => setReload((n) => n + 1), notify);

  const columns: Column<ContactMessage>[] = [
    {
      header: 'Asunto',
      cell: (m) => (
        <button type="button" className={`text-left hover:underline ${m.leido ? '' : 'font-bold'}`} onClick={() => setOpen(m)}>
          {m.asunto}
          <Sub>{m.cuerpo.slice(0, 80)}</Sub>
        </button>
      ),
    },
    { header: 'De', cell: (m) => <span>{m.nombre}<Sub>{m.correo}</Sub></span> },
    { header: 'Fecha', cell: (m) => formatDateTime(m.creado_en) },
    { header: 'Estado', cell: (m) => <Badge tone={m.leido ? 'neutral' : 'warning'}>{m.leido ? 'Leído' : 'Sin leer'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (m) => (
        <Button size="sm" variant="secondary" loading={busy === String(m.id)} onClick={() => run(String(m.id), () => supportApi.setRead(m.id, !m.leido), m.leido ? 'Marcado como sin leer.' : 'Marcado como leído.')}>
          {m.leido ? 'Sin leer' : 'Leído'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Mensajes"
        load={(p, signal) => supportApi.list({ page: p.page, limit: p.limit, leido: (p.status as BoolFilter) ?? '' }, signal)}
        columns={columns}
        rowKey={(m) => String(m.id)}
        statuses={[
          { value: 'false', label: 'Sin leer' },
          { value: 'true', label: 'Leídos' },
        ]}
        reloadKey={reload}
      />
      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.asunto}>
          <p className="text-sm text-ink-soft">
            {open.nombre} · <a className="link" href={`mailto:${open.correo}`}>{open.correo}</a> · {formatDateTime(open.creado_en)}
          </p>
          <p className="mt-4 whitespace-pre-line">{open.cuerpo}</p>
        </Modal>
      )}
    </>
  );
}

/** Facturas electrónicas de ms-invoicing y su estado en el SRI. */
export function AdminInvoicesPage() {
  const [sri, setSri] = useState('');
  const columns: Column<Invoice>[] = [
    { header: 'Factura', cell: (f) => <span className="font-semibold">{f.numero}<Sub>Orden #{f.ord_id}</Sub></span> },
    { header: 'A nombre de', cell: (f) => <span>{f.razon_social}<Sub>{f.identificacion}</Sub></span> },
    { header: 'Emitida', cell: (f) => formatDateTime(f.emitida_en) },
    { header: 'Total', align: 'right', cell: (f) => formatMoney(f.total) },
    { header: 'Estado', cell: (f) => <Badge tone={f.estado === 'PAGADA' ? 'success' : f.estado === 'ANULADA' ? 'danger' : 'warning'}>{f.estado}</Badge> },
    {
      header: 'SRI',
      cell: (f) => (
        <span>
          <Badge tone={f.estado_sri === 'AUTORIZADA' ? 'success' : f.estado_sri === 'RECHAZADA' ? 'danger' : 'warning'}>{f.estado_sri}</Badge>
          {f.autorizacion_sri && <Sub>{f.autorizacion_sri}</Sub>}
        </span>
      ),
    },
  ];

  return (
    <AdminTable
      title="Facturas"
      load={(p, signal) => operationsApi.invoices({ page: p.page, limit: p.limit, estado: p.status, estado_sri: sri }, signal)}
      columns={columns}
      rowKey={(f) => String(f.id)}
      statuses={[
        { value: 'PAGADA', label: 'Pagadas' },
        { value: 'NO_PAGADA', label: 'No pagadas' },
        { value: 'ANULADA', label: 'Anuladas' },
      ]}
      extraFilters={
        <Select
          label="SRI"
          value={sri}
          onChange={(e) => setSri(e.target.value)}
          options={[
            { value: '', label: 'Todos' },
            { value: 'PENDIENTE', label: 'Pendientes' },
            { value: 'AUTORIZADA', label: 'Autorizadas' },
            { value: 'RECHAZADA', label: 'Rechazadas' },
          ]}
        />
      }
      extraKey={sri}
    />
  );
}

/** Socios con `X-API-Key` (ms-identity). La clave solo se muestra al crearla. */
export function AdminPartnersPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiClient | null>(null);
  const [renaming, setRenaming] = useState<ApiClient | null>(null);
  const [regenerating, setRegenerating] = useState<ApiClient | null>(null);
  const { busy, run } = useRowAction(() => setReload((n) => n + 1), notify);

  const columns: Column<ApiClient>[] = [
    { header: 'Socio', cell: (c) => <span className="font-semibold">{c.nombre}<Sub>{c.codigo}</Sub></span> },
    { header: 'Creado', cell: (c) => formatDateTime(c.creado_en) },
    { header: 'Último uso', cell: (c) => (c.ultimo_uso ? formatDateTime(c.ultimo_uso) : <span className="text-ink-muted">Nunca</span>) },
    { header: 'Estado', cell: (c) => <Badge tone={c.activo ? 'success' : 'neutral'}>{c.activo ? 'Activo' : 'Inactivo'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (c) => (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setRenaming(c)} aria-label={`Renombrar ${c.nombre}`}>
            <Pencil size={15} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="tertiary" onClick={() => setRegenerating(c)} aria-label={`Regenerar la clave de ${c.nombre}`}>
            <KeyRound size={15} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="secondary" loading={busy === String(c.id)} onClick={() => run(String(c.id), () => apiClientsApi.setActive(c.id, !c.activo), c.activo ? 'Socio desactivado: su clave deja de funcionar.' : 'Socio activado.')}>
            {c.activo ? 'Desactivar' : 'Activar'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Socios (clientes API)"
        load={async (p, signal) => pageOf(await apiClientsApi.list(signal), p.page, p.limit)}
        columns={columns}
        rowKey={(c) => String(c.id)}
        reloadKey={reload}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> Nuevo socio
          </Button>
        }
      />
      {creating && (
        <PartnerDialog
          onClose={() => setCreating(false)}
          onCreated={(client) => {
            setCreating(false);
            setCreated(client);
            setReload((n) => n + 1);
          }}
        />
      )}
      {renaming && (
        <RenamePartnerDialog
          client={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            setReload((n) => n + 1);
          }}
        />
      )}
      {regenerating && (
        <RegenerateKeyDialog
          client={regenerating}
          onClose={() => setRegenerating(null)}
          onDone={(client) => {
            setRegenerating(null);
            setCreated(client);
          }}
        />
      )}
      {created && (
        <Modal open size="sm" onClose={() => setCreated(null)} title={`Clave de ${created.nombre}`} footer={<Button onClick={() => setCreated(null)}>Ya la guardé</Button>}>
          <Alert>Esta es la única vez que se muestra. Guárdala y entrégala por un canal seguro.</Alert>
          <p className="mt-4 break-all rounded-sm bg-surface p-3 font-mono text-sm">{created.api_key}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              void navigator.clipboard.writeText(created.api_key);
              notify('Clave copiada.', 'success');
            }}
          >
            <Copy size={15} aria-hidden="true" /> Copiar
          </Button>
        </Modal>
      )}
    </>
  );
}

function RenamePartnerDialog({ client, onClose, onSaved }: { client: ApiClient; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [nombre, setNombre] = useState(client.nombre);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClientsApi.rename(client.id, nombre.trim());
      notify('Socio renombrado.', 'success');
      onSaved();
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
      title={`Renombrar ${client.codigo}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!nombre.trim()} onClick={save}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Nombre" maxLength={150} value={nombre} onChange={(e) => setNombre(e.target.value)} error={fieldError(error, 'nombre')} />
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}

function RegenerateKeyDialog({ client, onClose, onDone }: { client: ApiClient; onClose: () => void; onDone: (client: CreatedApiClient) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await apiClientsApi.regenerateKey(client.id));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Regenerar la clave de ${client.nombre}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" loading={busy} onClick={regenerate}>Regenerar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-soft">La clave actual dejará de funcionar. Este socio no podrá consultar ni reservar hasta que configure la nueva.</p>
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}

function PartnerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (client: CreatedApiClient) => void }) {
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await apiClientsApi.create(codigo.trim(), nombre.trim()));
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
      title="Nuevo socio"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!codigo.trim() || !nombre.trim()} onClick={save}>Crear</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Código" maxLength={60} placeholder="BOOKING-PROTOTIPO" value={codigo} onChange={(e) => setCodigo(e.target.value)} error={fieldError(error, 'codigo')} />
        <Input label="Nombre" maxLength={150} value={nombre} onChange={(e) => setNombre(e.target.value)} error={fieldError(error, 'nombre')} />
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}
