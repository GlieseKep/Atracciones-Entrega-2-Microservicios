import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { catalogApi } from '@/api/admin';
import { listCities } from '@/api/catalog';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input, TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { useAsync } from '@/hooks/useAsync';
import { useUiStore } from '@/stores/uiStore';
import type { AdminAttraction, AttractionRequest, AttractionType } from '@/types/admin';
import { errorMessage, fieldError } from '@/utils/api';

const TYPES: { value: AttractionType; label: string }[] = [
  { value: 'GUIDED_TOUR', label: 'Tour guiado' },
  { value: 'ADMISSION', label: 'Entrada' },
  { value: 'DAY_TRIP', label: 'Excursión de un día' },
  { value: 'TRANSPORT', label: 'Transporte' },
  { value: 'PACKAGE', label: 'Paquete' },
];

/**
 * Operador propio (TourGirls Tours & Experiences, en `seed/catalogo-v2.json`). El portal solo publica atracciones propias,
 * así que el formulario no deja elegirlo: Catalog lo exige y con él asigna los guías.
 */
const HOUSE_OPERATOR = 'proveedor-atracciones-dilan';

const num = (min: number, max: number, message: string) => z.coerce.number({ invalid_type_error: message }).min(min, message).max(max, message);

const schema = z
  .object({
    name: z.string().trim().min(3, 'Mínimo 3 caracteres.').max(200),
    slug: z.string().trim().regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, 'Solo minúsculas, números y guiones.'),
    short_description: z.string().trim().max(280),
    description: z.string().trim().min(1, 'Describe la experiencia.'),
    tipo: z.enum(['GUIDED_TOUR', 'ADMISSION', 'DAY_TRIP', 'TRANSPORT', 'PACKAGE']),
    operador: z.string().min(1),
    ciu_id: z.coerce.number().int().min(1, 'Elige la ciudad.'),
    duration_hours: num(0.01, 720, 'Entre 0,01 y 720 horas.'),
    latitude: num(-90, 90, 'Latitud entre -90 y 90.'),
    longitude: num(-180, 180, 'Longitud entre -180 y 180.'),
    address: z.string().trim().max(255),
    meeting_point: z.string().trim().max(255),
    arrival_instructions: z.string().trim().max(500),
    categorias: z.array(z.string()).min(1, 'Elige al menos una categoría.'),
    idiomas: z.array(z.string()),
    inclusiones: z.array(z.string()),
    fotos: z.array(
      z.object({
        url: z.string().trim().min(1, 'Indica la URL.').max(500),
        alt: z.string().trim().max(200),
      }),
    ),
    itinerario: z.array(
      z.object({
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm'),
        title: z.string().trim().min(1, 'Título.').max(200),
        description: z.string().trim().max(500),
        duration_minutes: num(1, 32767, 'Minutos.'),
        location_name: z.string().trim().max(200),
      }),
    ),
    includes_food: z.boolean(),
    includes_transport: z.boolean(),
    includes_guide: z.boolean(),
    wheelchair_accessible: z.boolean(),
    stroller_accessible: z.boolean(),
    service_animals_allowed: z.boolean(),
    free_cancellation: z.boolean(),
    deadline_hours: num(0, 32767, 'Horas no válidas.'),
    policy_description: z.string().trim().max(500),
    permite_paquete: z.boolean(),
    porcentaje_descuento_paquete: num(0, 100, 'Entre 0 y 100.'),
    destacada: z.boolean(),
  })
  .refine((v) => v.permite_paquete || v.porcentaje_descuento_paquete === 0, {
    path: ['porcentaje_descuento_paquete'],
    message: 'El descuento requiere permitir paquetes.',
  });
type Values = z.infer<typeof schema>;

/** El itinerario llega como `02:30 p.m.`; el formulario y Catalog trabajan en 24 horas. */
function to24h(label: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?/i.exec(label.trim());
  if (!match) return '09:00';
  const period = match[3]?.toLowerCase();
  const hour = (Number(match[1]) % (period ? 12 : 24)) + (period === 'p' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

const toValues = (a: AdminAttraction | null): Values => ({
  name: a?.name ?? '',
  slug: a?.slug ?? '',
  short_description: a?.short_description ?? '',
  description: a?.description ?? '',
  tipo: a?.tipo ?? 'GUIDED_TOUR',
  operador: a?.operador ?? HOUSE_OPERATOR,
  ciu_id: a?.ciu_id ?? 0,
  duration_hours: a?.duration_hours ?? 2,
  latitude: a?.meeting_point_geo.latitude ?? -0.1807,
  longitude: a?.meeting_point_geo.longitude ?? -78.4678,
  address: a?.address ?? '',
  meeting_point: a?.meeting_point ?? '',
  arrival_instructions: a?.meeting_point_geo.arrival_instructions ?? '',
  categorias: a?.categorias ?? [],
  idiomas: a?.idiomas ?? [],
  inclusiones: (a?.inclusiones ?? []).map(String),
  fotos: [...(a?.fotos ?? [])].sort((x, y) => x.orden - y.orden).map((f) => ({ url: f.url, alt: f.alt })),
  itinerario: (a?.itinerary ?? []).map((s) => ({
    time: to24h(s.time),
    title: s.title,
    description: s.description ?? '',
    duration_minutes: s.duration_minutes,
    location_name: s.location_name ?? '',
  })),
  includes_food: a?.inclusions.includes_food ?? false,
  includes_transport: a?.inclusions.includes_transport ?? false,
  includes_guide: a?.inclusions.includes_guide ?? false,
  wheelchair_accessible: a?.accessibility?.wheelchair_accessible ?? false,
  stroller_accessible: a?.accessibility?.stroller_accessible ?? false,
  service_animals_allowed: a?.accessibility?.service_animals_allowed ?? false,
  free_cancellation: a?.cancellation_policy?.free_cancellation ?? true,
  deadline_hours: a?.cancellation_policy?.deadline_hours ?? 24,
  policy_description: a?.cancellation_policy?.description ?? '',
  permite_paquete: a?.permite_paquete ?? false,
  porcentaje_descuento_paquete: a?.porcentaje_descuento_paquete ?? 0,
  destacada: a?.destacada ?? false,
});

const opt = (value: string) => (value ? value : undefined);

/**
 * `inclusiones` son las casillas de lo que sí incluye. `kept` son los «no incluye» y las recomendaciones que la atracción
 * ya tenía: el editor no los muestra, pero no se deben perder al guardar.
 */
function toRequest(v: Values, name: string, kept: number[]): AttractionRequest {
  return {
    name: v.name,
    slug: opt(v.slug),
    description: v.description,
    short_description: opt(v.short_description),
    tipo: v.tipo,
    latitude: v.latitude,
    longitude: v.longitude,
    address: opt(v.address),
    meeting_point: opt(v.meeting_point),
    arrival_instructions: opt(v.arrival_instructions),
    duration_hours: v.duration_hours,
    ciu_id: v.ciu_id,
    operador: v.operador,
    categorias: v.categorias,
    idiomas: v.idiomas,
    inclusiones: [...new Set([...v.inclusiones.map(Number), ...kept])],
    fotos: v.fotos.map((foto, orden) => ({ url: foto.url, alt: foto.alt || `${name}, foto ${orden + 1}`, orden })),
    itinerario: v.itinerario.map((s, i) => ({
      stop_number: i + 1,
      time: s.time,
      title: s.title,
      description: opt(s.description),
      duration_minutes: s.duration_minutes,
      location_name: opt(s.location_name),
    })),
    inclusions: { includes_food: v.includes_food, includes_transport: v.includes_transport, includes_guide: v.includes_guide },
    accessibility: { wheelchair_accessible: v.wheelchair_accessible, stroller_accessible: v.stroller_accessible, service_animals_allowed: v.service_animals_allowed },
    cancellation_policy: { free_cancellation: v.free_cancellation, deadline_hours: v.deadline_hours, description: opt(v.policy_description) },
    permite_paquete: v.permite_paquete,
    porcentaje_descuento_paquete: v.porcentaje_descuento_paquete,
    destacada: v.destacada,
  };
}

/** Ficha de ms-catalog (`AtraccionRequest`). El precio vive en Pricing y los horarios en Inventory. */
export function AttractionEditor({ attraction, onClose, onSaved }: { attraction: AdminAttraction | null; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [error, setError] = useState<unknown>(null);
  const options = useAsync(
    async (signal) => {
      const [cities, categories, languages, inclusions] = await Promise.all([
        listCities(signal),
        catalogApi.categories(signal),
        catalogApi.languages(signal),
        catalogApi.inclusions(signal),
      ]);
      return { cities, categories, languages, inclusions };
    },
    [],
  );
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(attraction) });
  /** Provincia elegida; `null` mientras no se toque, y entonces se toma la de la ciudad que ya tiene la atracción. */
  const [province, setProvince] = useState<number | null>(null);
  const stops = useFieldArray({ control, name: 'itinerario' });
  const photos = useFieldArray({ control, name: 'fotos' });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const included = new Set((options.data?.inclusions ?? []).filter((i) => i.tipo === 'INCLUYE').map((i) => i.id));
      const body = toRequest(v, v.name, (attraction?.inclusiones ?? []).filter((id) => !included.has(id)));
      if (attraction) await catalogApi.update(attraction.id, body);
      else await catalogApi.create(body);
      notify(attraction ? 'Atracción actualizada.' : 'Atracción creada como borrador. Define tarifas y horarios y luego publícala.', 'success');
      onSaved();
    } catch (e) {
      setError(e);
    }
  });

  const err = (name: string) => fieldError(error, name);
  const o = options.data;
  // Las ciudades ya traen su provincia: el filtro se hace aquí, sin otra llamada a ms-location.
  const provinces = o
    ? [...new Map(o.cities.map((c) => [c.provincia.id, c.provincia])).values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    : [];
  const provinceId = province ?? o?.cities.find((c) => c.id === attraction?.ciu_id)?.provincia.id ?? 0;
  const citiesOfProvince = o ? o.cities.filter((c) => c.provincia.id === provinceId).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) : [];
  const check =(name: keyof Values, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="h-[18px] w-[18px] accent-[#C94D6B]" {...register(name)} /> {label}
    </label>
  );

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={attraction ? `Editar ${attraction.name}` : 'Nueva atracción'}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={isSubmitting} disabled={!o} onClick={submit}>
            Guardar
          </Button>
        </>
      }
    >
      {options.status === 'error' ? (
        <Alert tone="error">{errorMessage(options.error)}</Alert>
      ) : !o ? (
        <div className="skeleton h-96" aria-busy="true" />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-6">
          <Fieldset title="Datos generales">
            <Input label="Nombre" className="sm:col-span-2" error={errors.name?.message ?? err('name')} {...register('name')} />
            <Select label="Tipo" options={TYPES} {...register('tipo')} />
            <Select
              label="Provincia"
              value={String(provinceId)}
              onChange={(e) => {
                setProvince(Number(e.target.value));
                setValue('ciu_id', 0);
              }}
              options={[{ value: '0', label: 'Elige…' }, ...provinces.map((p) => ({ value: String(p.id), label: p.nombre }))]}
            />
            <Select
              label="Ciudad"
              disabled={provinceId === 0}
              options={[
                { value: '0', label: provinceId === 0 ? 'Elige primero la provincia' : 'Elige…' },
                ...citiesOfProvince.map((c) => ({ value: String(c.id), label: c.nombre })),
              ]}
              error={errors.ciu_id?.message ?? err('ciu_id')}
              {...register('ciu_id')}
            />
            <Input label="Duración (horas)" inputMode="decimal" error={errors.duration_hours?.message ?? err('duration_hours')} {...register('duration_hours')} />
            <Input label="Slug (opcional)" help="Para la URL; vacío lo genera el sistema." error={errors.slug?.message ?? err('slug')} {...register('slug')} />
            {check('destacada', 'Destacada en el portal')}
            <TextArea label="Descripción corta (opcional)" className="sm:col-span-2" maxLength={280} {...register('short_description')} />
            <TextArea label="Descripción" className="sm:col-span-2" rows={6} error={errors.description?.message ?? err('description')} {...register('description')} />
          </Fieldset>

          <Fieldset title="Categorías, idiomas e inclusiones">
            <CheckGroup
              label="Categorías"
              error={errors.categorias?.message ?? err('categorias')}
              items={o.categories.map((c) => ({ value: c.id, label: c.nombre }))}
              register={register('categorias')}
            />
            <CheckGroup label="Idiomas del guía" items={o.languages.map((l) => ({ value: l.codigo, label: l.nombre }))} register={register('idiomas')} />
            <div className="sm:col-span-2">
              <p className="field-label">Qué incluye</p>
              <div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-2">
                {check('includes_food', 'Alimentación')}
                {check('includes_transport', 'Transporte')}
                {check('includes_guide', 'Guía')}
                {o.inclusions
                  .filter((i) => i.tipo === 'INCLUYE')
                  .map((i) => (
                    <label key={i.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" value={String(i.id)} className="h-[18px] w-[18px] accent-[#C94D6B]" {...register('inclusiones')} /> {i.nombre}
                    </label>
                  ))}
              </div>
              <p className="field-help">Las opciones se agregan o quitan en la sección «Qué incluye» del panel.</p>
            </div>
          </Fieldset>

          <Fieldset title="Punto de encuentro">
            <Input label="Dirección (opcional)" error={err('address')} {...register('address')} />
            <Input label="Punto de encuentro (opcional)" error={err('meeting_point')} {...register('meeting_point')} />
            <Input label="Latitud" inputMode="decimal" error={errors.latitude?.message ?? err('latitude')} {...register('latitude')} />
            <Input label="Longitud" inputMode="decimal" error={errors.longitude?.message ?? err('longitude')} {...register('longitude')} />
            <TextArea label="Instrucciones de llegada (opcional)" className="sm:col-span-2" maxLength={500} {...register('arrival_instructions')} />
          </Fieldset>

          <Fieldset title="Itinerario">
            <ol className="space-y-3 sm:col-span-2">
              {stops.fields.map((field, i) => (
                <li key={field.id} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[90px_1fr_110px_auto]">
                  <Input label={`Parada ${i + 1}`} placeholder="09:00" error={errors.itinerario?.[i]?.time?.message} {...register(`itinerario.${i}.time`)} />
                  <Input label="Título" error={errors.itinerario?.[i]?.title?.message} {...register(`itinerario.${i}.title`)} />
                  <Input label="Minutos" inputMode="numeric" error={errors.itinerario?.[i]?.duration_minutes?.message} {...register(`itinerario.${i}.duration_minutes`)} />
                  <Button variant="tertiary" className="self-end" onClick={() => stops.remove(i)} aria-label={`Quitar parada ${i + 1}`}>
                    <Trash2 size={16} aria-hidden="true" />
                  </Button>
                  <Input label="Lugar (opcional)" {...register(`itinerario.${i}.location_name`)} />
                  <Input label="Descripción (opcional)" className="sm:col-span-3" {...register(`itinerario.${i}.description`)} />
                </li>
              ))}
            </ol>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => stops.append({ time: '09:00', title: '', description: '', duration_minutes: 30, location_name: '' })}
            >
              <Plus size={15} aria-hidden="true" /> Añadir parada
            </Button>
          </Fieldset>

          <Fieldset title="Fotos">
            <div className="space-y-3 sm:col-span-2">
              <p className="text-sm text-ink-soft">La primera es la portada. Sin texto alternativo, se genera con el nombre de la atracción.</p>
              {photos.fields.map((field, i) => (
                <div key={field.id} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Input label={`Foto ${i + 1}: URL`} error={errors.fotos?.[i]?.url?.message} {...register(`fotos.${i}.url`)} />
                  <Input label="Texto alternativo" maxLength={200} error={errors.fotos?.[i]?.alt?.message} {...register(`fotos.${i}.alt`)} />
                  <div className="flex items-end gap-1">
                    <Button variant="tertiary" size="sm" disabled={i === 0} onClick={() => photos.swap(i, i - 1)} aria-label={`Subir foto ${i + 1}`}>
                      <ArrowUp size={15} aria-hidden="true" />
                    </Button>
                    <Button variant="tertiary" size="sm" disabled={i === photos.fields.length - 1} onClick={() => photos.swap(i, i + 1)} aria-label={`Bajar foto ${i + 1}`}>
                      <ArrowDown size={15} aria-hidden="true" />
                    </Button>
                    <Button variant="tertiary" size="sm" onClick={() => photos.remove(i)} aria-label={`Quitar foto ${i + 1}`}>
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
              {err('fotos') && <p className="field-error">{err('fotos')}</p>}
              <Button variant="secondary" size="sm" onClick={() => photos.append({ url: '', alt: '' })}>
                <Plus size={15} aria-hidden="true" /> Añadir foto
              </Button>
            </div>
          </Fieldset>

          <Fieldset title="Accesibilidad, cancelación y paquetes">
            <div className="flex flex-wrap gap-4 sm:col-span-2">
              {check('wheelchair_accessible', 'Silla de ruedas')}
              {check('stroller_accessible', 'Coches de bebé')}
              {check('service_animals_allowed', 'Animales de asistencia')}
            </div>
            {check('free_cancellation', 'Cancelación gratuita')}
            <Input label="Horas límite para cancelar" inputMode="numeric" error={errors.deadline_hours?.message} {...register('deadline_hours')} />
            <TextArea label="Política de cancelación (opcional)" className="sm:col-span-2" maxLength={500} {...register('policy_description')} />
            {check('permite_paquete', 'Permite paquetes de Booking')}
            <Input label="Descuento máximo en paquetes (%)" inputMode="decimal" error={errors.porcentaje_descuento_paquete?.message} {...register('porcentaje_descuento_paquete')} />
          </Fieldset>

          {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
        </form>
      )}
    </Modal>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-2 text-base font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

function CheckGroup({
  label,
  items,
  register,
  error,
  className = '',
}: {
  label: string;
  items: { value: string; label: string }[];
  register: ReturnType<ReturnType<typeof useForm<Values>>['register']>;
  error?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="field-label">{label}</p>
      <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border border-line p-3">
        {items.length === 0 && <p className="text-sm text-ink-muted">Sin opciones.</p>}
        {items.map((item) => (
          <label key={item.value} className="flex items-center gap-2 text-sm">
            <input type="checkbox" value={item.value} className="h-[18px] w-[18px] accent-[#C94D6B]" {...register} /> {item.label}
          </label>
        ))}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
