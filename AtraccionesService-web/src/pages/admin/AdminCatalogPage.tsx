import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { catalogAdmin } from '@/api/admin';
import { listAttractions } from '@/api/attractions';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { IconButton } from '@/components/common/IconButton';
import { Input, TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { Pagination } from '@/components/search/SearchResults';
import { useAsync } from '@/hooks/useAsync';
import { useIdempotentMutation } from '@/hooks/useReservations';
import { useUiStore } from '@/stores/uiStore';
import type { Attraction, CreateAttractionRequest } from '@/types/attraction';
import { errorMessage } from '@/utils/api';
import { formatDuration, formatPrice, PRODUCT_TYPE_LABEL } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { attractionFormSchema, splitList, type AttractionFormValues } from '@/utils/validation';

const PAGE = 10;

/** Gestión de catálogo: listado paginado, alta, edición (PUT) y baja con confirmación. */
export default function AdminCatalogPage() {
  const [page, setPage] = useState(1);
  const list = useAsync((signal) => listAttractions(PAGE, (page - 1) * PAGE, signal), [page]);
  const [editing, setEditing] = useState<Attraction | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Attraction | null>(null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">Catálogo</h1>
        <Button onClick={() => setEditing('new')}>
          <Plus size={18} aria-hidden="true" /> Nueva atracción
        </Button>
      </div>

      <div className="mt-6">
        {list.status === 'error' ? (
          <ErrorState error={list.error} onRetry={list.retry} />
        ) : !list.data ? (
          <div className="skeleton h-72" aria-busy="true" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Atracciones del catálogo</caption>
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-3">Nombre</th>
                  <th scope="col" className="px-4 py-3">Tipo</th>
                  <th scope="col" className="px-4 py-3">Ciudad</th>
                  <th scope="col" className="px-4 py-3">Duración</th>
                  <th scope="col" className="px-4 py-3 text-right">Precio</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-brand-50/50">
                    <td className="px-4 py-3 font-semibold">
                      <Link to={paths.attraction(a.id)} className="hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{PRODUCT_TYPE_LABEL[a.productType]}</td>
                    <td className="px-4 py-3">{a.locations[0]?.city}</td>
                    <td className="px-4 py-3">{formatDuration(a.duration)}</td>
                    <td className="px-4 py-3 text-right">{formatPrice(a.price)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconButton aria-label={`Editar ${a.name}`} icon={<Pencil size={16} aria-hidden="true" />} onClick={() => setEditing(a)} />
                        <IconButton
                          aria-label={`Eliminar ${a.name}`}
                          icon={<Trash2 size={16} className="text-danger" aria-hidden="true" />}
                          onClick={() => setDeleting(a)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onPage={setPage} />}
      </div>

      {editing && (
        <AttractionEditor
          attraction={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.retry();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          attraction={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            list.retry();
          }}
        />
      )}
    </div>
  );
}

function toForm(a: Attraction | null): AttractionFormValues {
  const loc = a?.locations[0];
  return {
    name: a?.name ?? '',
    longDescription: a?.longDescription ?? '',
    duration: a?.duration ?? 'PT2H',
    priceTotal: a?.price.total ?? 10,
    currency: a?.price.currency ?? 'USD',
    productType: a?.productType ?? 'GUIDED_TOUR',
    categories: a?.categories.join(', ') ?? '',
    badges: a?.badges.join(', ') ?? '',
    includes: a?.includes.join(', ') ?? '',
    supportedLanguages: a?.supportedLanguages.join(', ') ?? 'es',
    photos: a?.photos.map((p) => p.url).join('\n') ?? '',
    address: loc?.address ?? '',
    city: loc?.city ?? '',
    country: loc?.country ?? 'EC',
    freeCancellation: a?.freeCancellation ?? true,
  };
}

function toRequest(v: AttractionFormValues, original: Attraction | null): CreateAttractionRequest {
  const loc = original?.locations[0];
  return {
    name: v.name.trim(),
    longDescription: v.longDescription.trim(),
    duration: v.duration.trim(),
    price: { currency: v.currency, total: Number(v.priceTotal) },
    productType: v.productType,
    categories: splitList(v.categories),
    badges: splitList(v.badges),
    includes: splitList(v.includes),
    supportedLanguages: splitList(v.supportedLanguages),
    photos: splitList(v.photos).map((url) => ({ url })),
    locations: [
      {
        address: v.address.trim(),
        city: v.city.trim(),
        country: v.country,
        coordinates: loc?.coordinates ?? null,
        type: loc?.type ?? 'MEETING_POINT',
      },
      ...(original?.locations.slice(1) ?? []),
    ],
    operator: original?.operator ?? null,
    freeCancellation: v.freeCancellation,
  };
}

function AttractionEditor({ attraction, onClose, onSaved }: { attraction: Attraction | null; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const { run, pending, error } = useIdempotentMutation<CreateAttractionRequest, unknown>(
    useCallback(
      (body, key) => (attraction ? catalogAdmin.replace(attraction.id, body, key) : catalogAdmin.create(body, key)),
      [attraction],
    ),
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AttractionFormValues>({ resolver: zodResolver(attractionFormSchema), defaultValues: toForm(attraction) });

  const submit = handleSubmit(async (values) => {
    try {
      await run(toRequest(values, attraction));
      notify(attraction ? 'Atracción actualizada.' : 'Atracción creada.', 'success');
      onSaved();
    } catch {
      /* se muestra en el formulario */
    }
  });

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={attraction ? 'Editar atracción' : 'Nueva atracción'}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={pending} onClick={submit}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Nombre" error={errors.name?.message} {...register('name')} />
        <TextArea className="sm:col-span-2" label="Descripción" error={errors.longDescription?.message} {...register('longDescription')} />
        <Input label="Duración (ISO 8601)" help="PT2H, PT1H30M, P1D" error={errors.duration?.message} {...register('duration')} />
        <Select
          label="Tipo de producto"
          {...register('productType')}
          options={Object.entries(PRODUCT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Input label="Precio" type="number" step="0.01" min="0.01" error={errors.priceTotal?.message} {...register('priceTotal')} />
        <Input label="Moneda" maxLength={3} error={errors.currency?.message} {...register('currency')} />
        <Input label="Categorías" help="Separadas por comas" error={errors.categories?.message} {...register('categories')} />
        <Input label="Insignias" help="Separadas por comas" {...register('badges')} />
        <Input label="Incluye" help="Separado por comas" {...register('includes')} />
        <Input label="Idiomas" help="Códigos separados por comas: es, en" {...register('supportedLanguages')} />
        <Input label="Dirección del punto de encuentro" error={errors.address?.message} {...register('address')} />
        <Input label="Ciudad" error={errors.city?.message} {...register('city')} />
        <Input label="País (ISO 3166-1)" maxLength={2} error={errors.country?.message} {...register('country')} />
        <TextArea className="sm:col-span-2" label="URLs de fotos (una por línea)" {...register('photos')} />
        <label className="flex items-center gap-3 sm:col-span-2">
          <input type="checkbox" className="h-[18px] w-[18px] accent-[#C94D6B]" {...register('freeCancellation')} />
          Cancelación gratuita
        </label>
        {!!error && (
          <Alert tone="error" className="sm:col-span-2">
            {errorMessage(error)}
          </Alert>
        )}
      </form>
    </Modal>
  );
}

function DeleteDialog({ attraction, onClose, onDeleted }: { attraction: Attraction; onClose: () => void; onDeleted: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const { run, pending, error } = useIdempotentMutation<string, void>(useCallback((id, key) => catalogAdmin.remove(id, key), []));
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Eliminar atracción"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={async () => {
              try {
                await run(attraction.id);
                notify('Atracción eliminada.', 'success');
                onDeleted();
              } catch {
                /* se muestra abajo */
              }
            }}
          >
            Eliminar
          </Button>
        </>
      }
    >
      <p>
        ¿Seguro que quieres eliminar <strong>{attraction.name}</strong>? El servidor rechazará la operación si tiene reservas activas.
      </p>
      {!!error && (
        <Alert tone="error" className="mt-4">
          {errorMessage(error)}
        </Alert>
      )}
    </Modal>
  );
}
