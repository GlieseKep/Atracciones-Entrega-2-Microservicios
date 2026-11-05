import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarRange, DollarSign, Pencil, Plus, Trash2 } from 'lucide-react';
import { catalogApi, pricingApi } from '@/api/admin';
import { Badge, type BadgeTone } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { useAsync } from '@/hooks/useAsync';
import { useUiStore } from '@/stores/uiStore';
import type { AdminAttraction, AttractionState } from '@/types/admin';
import { errorMessage, fieldError, isApiError } from '@/utils/api';
import { formatDate, today } from '@/utils/dates';
import { formatMoney } from '@/utils/formatters';
import { AdminTable, Sub, useRowAction, type Column } from './AdminTable';
import { AttractionEditor } from './AttractionEditor';

const STATES: { value: AttractionState; label: string; tone: BadgeTone }[] = [
  { value: 'BORRADOR', label: 'Borrador', tone: 'warning' },
  { value: 'PUBLICADA', label: 'Publicada', tone: 'success' },
  { value: 'INACTIVA', label: 'Inactiva', tone: 'neutral' },
];

/** Atracciones de ms-catalog en cualquier estado, con sus tarifas (ms-pricing) y el acceso a sus horarios (ms-inventory). */
export default function AdminCatalogPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [pricing, setPricing] = useState<AdminAttraction | null>(null);
  const [deleting, setDeleting] = useState<AdminAttraction | null>(null);
  const refresh = () => setReload((n) => n + 1);
  const { busy, run } = useRowAction(refresh, notify);

  const columns: Column<AdminAttraction>[] = [
    {
      header: 'Atracción',
      cell: (a) => (
        <button type="button" className="text-left font-semibold hover:underline" onClick={() => setEditing(a.id)}>
          {a.name}
          <Sub>
            {a.id} · {a.city}
          </Sub>
        </button>
      ),
    },
    { header: 'Operador', cell: (a) => a.proveedor?.nombre_comercial ?? a.operador },
    { header: 'Duración', cell: (a) => a.duration ?? '—' },
    { header: 'Adulto', align: 'right', cell: (a) => formatMoney(a.price.adult, a.price.currency) },
    {
      header: 'Estado',
      cell: (a) => {
        const state = STATES.find((s) => s.value === a.estado);
        return <Badge tone={state?.tone ?? 'neutral'}>{state?.label ?? a.estado}</Badge>;
      },
    },
    {
      header: '',
      align: 'right',
      cell: (a) => (
        <span className="inline-flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="tertiary" onClick={() => setEditing(a.id)} aria-label={`Editar ${a.name}`}>
            <Pencil size={15} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="tertiary" onClick={() => setPricing(a)} aria-label={`Tarifas de ${a.name}`}>
            <DollarSign size={15} aria-hidden="true" />
          </Button>
          <Link
            to={`/admin/disponibilidad?atraccion=${a.id}`}
            aria-label={`Horarios de ${a.name}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface"
          >
            <CalendarRange size={15} aria-hidden="true" />
          </Link>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === a.id}
            onClick={() => {
              const next: AttractionState = a.estado === 'PUBLICADA' ? 'INACTIVA' : 'PUBLICADA';
              void run(
                a.id,
                async () => {
                  const updated = await catalogApi.setState(a.id, next);
                  if (updated.stock_sincronizado === false) notify('No se pudo avisar los cupos a Booking. Vuelva a publicar o retirar la atracción.', 'error');
                },
                next === 'PUBLICADA' ? 'Atracción publicada.' : 'Atracción retirada del portal.',
              );
            }}
          >
            {a.estado === 'PUBLICADA' ? 'Retirar' : 'Publicar'}
          </Button>
          <Button size="sm" variant="tertiary" onClick={() => setDeleting(a)} aria-label={`Eliminar ${a.name}`}>
            <Trash2 size={15} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Catálogo"
        load={(p, signal) => catalogApi.list({ page: p.page, limit: Math.min(p.limit, 50), q: p.search, estado: (p.status as AttractionState | '') ?? '' }, signal)}
        columns={columns}
        rowKey={(a) => a.id}
        searchPlaceholder="Nombre de la atracción"
        statuses={STATES.map(({ value, label }) => ({ value, label }))}
        reloadKey={reload}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Nueva atracción
          </Button>
        }
      />
      {editing && (
        <EditorLoader
          id={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {pricing && (
        <PriceDialog
          attraction={pricing}
          onClose={() => setPricing(null)}
          onSaved={() => {
            setPricing(null);
            refresh();
          }}
        />
      )}
      {deleting && (
        <Modal
          open
          size="sm"
          onClose={() => setDeleting(null)}
          title="Eliminar atracción"
          footer={
            <>
              <Button variant="tertiary" onClick={() => setDeleting(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={busy === `del-${deleting.id}`}
                onClick={async () => {
                  await run(`del-${deleting.id}`, () => catalogApi.remove(deleting.id), 'Atracción eliminada.');
                  setDeleting(null);
                }}
              >
                Eliminar
              </Button>
            </>
          }
        >
          <p className="text-ink-soft">
            «{deleting.name}» dejará de aparecer en el portal y en este listado. Si solo quieres ocultarla un tiempo, usa «Retirar».
          </p>
        </Modal>
      )}
    </>
  );
}

/** El listado no alcanza para editar: se pide la ficha de administración completa. */
function EditorLoader({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const attraction = useAsync((signal) => catalogApi.get(id, signal), [id], id !== 'new');
  if (id === 'new') return <AttractionEditor attraction={null} onClose={onClose} onSaved={onSaved} />;
  if (attraction.status === 'error') {
    return (
      <Modal open onClose={onClose} title="Editar atracción">
        <ErrorState error={attraction.error} onRetry={attraction.retry} />
      </Modal>
    );
  }
  if (!attraction.data) {
    return (
      <Modal open onClose={onClose} title="Editar atracción">
        <div className="skeleton h-64" aria-busy="true" />
      </Modal>
    );
  }
  return <AttractionEditor attraction={attraction.data} onClose={onClose} onSaved={onSaved} />;
}

const money = (message: string) => z.coerce.number({ invalid_type_error: message }).min(0, message);
const priceSchema = z.object({
  valid_from: z.string().min(1, 'Indica la fecha.'),
  adult: z.coerce.number({ invalid_type_error: 'Debe ser mayor que 0.' }).positive('Debe ser mayor que 0.'),
  child: money('No puede ser negativa.'),
  senior: money('No puede ser negativa.'),
  student: z.string().trim().regex(/^(\d+([.,]\d{1,2})?)?$/, 'Precio no válido.'),
});
type PriceValues = z.infer<typeof priceSchema>;

/** Tabla de precios vigente (ms-pricing). Una tabla nueva rige desde `valid_from`; la infantil es siempre 0. */
function PriceDialog({ attraction: a, onClose, onSaved }: { attraction: AdminAttraction; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const current = useAsync((signal) => pricingApi.get(a.id, signal).catch((e) => (isApiError(e, 'notFound') ? null : Promise.reject(e))), [a.id]);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PriceValues>({
    resolver: zodResolver(priceSchema),
    values: {
      valid_from: today(),
      adult: current.data?.adult ?? 0,
      child: current.data?.child ?? 0,
      senior: current.data?.senior ?? 0,
      student: current.data?.student === undefined ? '' : String(current.data.student),
    },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await pricingApi.set({
        attraction_id: a.id,
        valid_from: v.valid_from,
        adult: v.adult,
        child: v.child,
        senior: v.senior,
        ...(v.student ? { student: Number(v.student.replace(',', '.')) } : {}),
      });
      notify('Tarifas guardadas.', 'success');
      onSaved();
    } catch (e) {
      setError(e);
    }
  });
  const err = (name: keyof PriceValues) => errors[name]?.message ?? fieldError(error, name);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Tarifas de ${a.name}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={isSubmitting} disabled={current.status === 'loading'} onClick={submit}>
            Guardar
          </Button>
        </>
      }
    >
      {current.status === 'error' ? (
        <ErrorState error={current.error} onRetry={current.retry} />
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Input label="Vigente desde" type="date" min={today()} className="sm:col-span-2" error={err('valid_from')} {...register('valid_from')} />
          <Input label="Adulto (US$)" inputMode="decimal" error={err('adult')} {...register('adult')} />
          <Input label="Niño (US$)" inputMode="decimal" error={err('child')} {...register('child')} />
          <Input label="Adulto mayor (US$)" inputMode="decimal" error={err('senior')} {...register('senior')} />
          <Input label="Estudiante (US$, opcional)" inputMode="decimal" error={err('student')} {...register('student')} />
          {error !== null && (
            <div className="sm:col-span-2">
              <Alert tone="error">{errorMessage(error)}</Alert>
            </div>
          )}
        </form>
      )}
      <TariffHistory attractionId={a.id} />
    </Modal>
  );
}

const TICKET_LABEL: Record<string, string> = { ADULT: 'Adulto', CHILD: 'Niño', SENIOR: 'Adulto mayor', INFANT: 'Infante', STUDENT: 'Estudiante' };

/** Vigentes, futuras y anteriores, como las devuelve ms-pricing. */
function TariffHistory({ attractionId }: { attractionId: string }) {
  const tariffs = useAsync((signal) => pricingApi.tariffs(attractionId, signal), [attractionId]);
  return (
    <section className="mt-6 border-t border-line pt-4">
      <h3 className="text-base">Historial de tarifas</h3>
      {tariffs.status === 'error' ? (
        <p className="mt-2 text-sm text-ink-muted">{errorMessage(tariffs.error)}</p>
      ) : !tariffs.data ? (
        <div className="skeleton mt-2 h-16" aria-busy="true" />
      ) : tariffs.data.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Sin tarifas registradas.</p>
      ) : (
        <div className="mt-2 max-h-52 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th scope="col" className="py-1 pr-3">Boleto</th>
                <th scope="col" className="py-1 pr-3">Precio</th>
                <th scope="col" className="py-1 pr-3">Vigencia</th>
                <th scope="col" className="py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tariffs.data.map((t) => (
                <tr key={t.tariff_id}>
                  <td className="py-1.5 pr-3">{TICKET_LABEL[t.ticket_type] ?? t.ticket_type}</td>
                  <td className="py-1.5 pr-3">{formatMoney(t.price, t.currency)}</td>
                  <td className="py-1.5 pr-3">{formatDate(t.valid_from)} — {t.valid_to ? formatDate(t.valid_to) : 'sin fin'}</td>
                  <td className="py-1.5">{t.current && <Badge tone="success">Vigente</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
