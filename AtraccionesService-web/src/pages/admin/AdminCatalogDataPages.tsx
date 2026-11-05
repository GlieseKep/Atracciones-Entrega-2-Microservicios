import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { catalogApi, pageOf } from '@/api/admin';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input, TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { useUiStore } from '@/stores/uiStore';
import type { AdminCategory, AdminLanguage, Inclusion } from '@/types/admin';
import { errorMessage, fieldError } from '@/utils/api';
import { AdminTable, Sub, useRowAction, type Column } from './AdminTable';

const usage = (n: number) => (n > 0 ? `${n} ${n === 1 ? 'atracción' : 'atracciones'}` : <span className="text-ink-muted">Sin usar</span>);

// Qué incluye ----------------------------------------------------------------------

/** Campos fijos del contrato v3: se marcan por atracción, no se crean ni se quitan. */
const FIXED = ['Alimentación', 'Transporte', 'Guía'];

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
const FIXED_NAMES = new Set([...FIXED, 'Comida'].flatMap((name) => [normalize(name), `incluye ${normalize(name)}`]));

type IncludeRow = { fixed: true; nombre: string } | ({ fixed: false } & Inclusion);

/** Lo que puede incluir una atracción. En el editor cada elemento es una casilla. */
export function AdminInclusionsPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const { busy, run } = useRowAction(() => setReload((n) => n + 1), notify);

  const columns: Column<IncludeRow>[] = [
    { header: 'Qué incluye', cell: (r) => <span className="font-semibold">{r.nombre}</span> },
    { header: 'Uso', cell: (r) => (r.fixed ? <Badge tone="neutral">Fija del contrato</Badge> : usage(r.atracciones)) },
    {
      header: '',
      align: 'right',
      cell: (r) =>
        r.fixed ? null : (
          <Button
            size="sm"
            variant="tertiary"
            disabled={r.atracciones > 0}
            loading={busy === String(r.id)}
            title={r.atracciones > 0 ? 'Quítala primero de las atracciones que la usan' : undefined}
            aria-label={`Quitar ${r.nombre}`}
            onClick={() => run(String(r.id), () => catalogApi.deleteInclusion(r.id), `«${r.nombre}» quitada.`)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </Button>
        ),
    },
  ];

  return (
    <>
      <AdminTable<IncludeRow>
        title="Qué incluye"
        load={async (p, signal) => {
          const items = await catalogApi.inclusions(signal);
          const rows: IncludeRow[] = [
            ...FIXED.map((nombre): IncludeRow => ({ fixed: true, nombre })),
            ...items.filter((i) => i.tipo === 'INCLUYE').map((i): IncludeRow => ({ fixed: false, ...i })),
          ];
          return pageOf(rows, p.page, p.limit);
        }}
        columns={columns}
        rowKey={(r) => (r.fixed ? `fija-${r.nombre}` : String(r.id))}
        reloadKey={reload}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> Agregar
          </Button>
        }
      />
      {creating && (
        <InclusionDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function InclusionDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const duplicate = FIXED_NAMES.has(normalize(nombre));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await catalogApi.createInclusion({ tipo: 'INCLUYE', nombre: nombre.trim(), orden: 0 });
      notify('Agregado. Ya aparece como casilla en el editor de atracciones.', 'success');
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
      title="Agregar a «Qué incluye»"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!nombre.trim() || duplicate} onClick={save}>
            Agregar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nombre"
          placeholder="Seguro de viaje"
          maxLength={150}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          error={duplicate ? 'Ya existe como casilla fija del contrato.' : fieldError(error, 'nombre')}
        />
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}

// Categorías -----------------------------------------------------------------------

/** Ordena el árbol con cada subcategoría bajo su padre, sin perder las de un padre desconocido. */
function asTree(items: AdminCategory[]): (AdminCategory & { nivel: number })[] {
  const known = new Set(items.map((c) => c.id));
  const walk = (padre: string | null, nivel: number): (AdminCategory & { nivel: number })[] =>
    items
      .filter((c) => (padre === null ? !c.padre_id || !known.has(c.padre_id) : c.padre_id === padre))
      .flatMap((c) => [{ ...c, nivel }, ...walk(c.id, nivel + 1)]);
  return walk(null, 0);
}

const slugify = (text: string) =>
  normalize(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Categorías de ms-catalog. El slug y la categoría padre se eligen al crear y no cambian después. */
export function AdminCategoriesPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<AdminCategory | 'new' | null>(null);
  const [all, setAll] = useState<AdminCategory[]>([]);
  const { busy, run } = useRowAction(() => setReload((n) => n + 1), notify);

  const flags = (c: AdminCategory) =>
    [c.incluye_comida && 'Comida', c.incluye_transporte && 'Transporte', c.incluye_guia && 'Guía'].filter(Boolean).join(', ') || <span className="text-ink-muted">—</span>;

  const columns: Column<AdminCategory & { nivel: number }>[] = [
    {
      header: 'Categoría',
      cell: (c) => (
        <span className="font-semibold" style={{ paddingLeft: `${c.nivel * 1.25}rem`, display: 'block' }}>
          {c.nombre}
          <Sub>{c.slug}</Sub>
        </span>
      ),
    },
    { header: 'Incluye', cell: flags },
    { header: 'Orden', cell: (c) => c.orden },
    { header: 'Uso', cell: (c) => usage(c.atracciones) },
    { header: 'Estado', cell: (c) => <Badge tone={c.activa ? 'success' : 'neutral'}>{c.activa ? 'Activa' : 'Inactiva'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (c) => (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setEditing(c)} aria-label={`Editar ${c.nombre}`}>
            <Pencil size={15} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === c.id}
            onClick={() => run(c.id, () => catalogApi.updateCategory(c.id, { activa: !c.activa }), c.activa ? 'Categoría desactivada.' : 'Categoría activada.')}
          >
            {c.activa ? 'Desactivar' : 'Activar'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Categorías"
        load={async (p, signal) => {
          const items = await catalogApi.adminCategories(signal);
          setAll(items);
          return pageOf(asTree(items), p.page, p.limit);
        }}
        columns={columns}
        rowKey={(c) => c.id}
        reloadKey={reload}
        pageSize={30}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Nueva categoría
          </Button>
        }
      />
      {editing && (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          parents={all.filter((c) => c.activa)}
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

const categorySchema = z.object({
  nombre: z.string().trim().min(1, 'Indica el nombre.').max(80),
  padre_id: z.string(),
  slug: z.string().trim().regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, 'Solo minúsculas, números y guiones.').max(80),
  descripcion: z.string().trim().max(255),
  icono: z.string().trim().min(1, 'Indica el icono.').max(40),
  orden: z.coerce.number({ invalid_type_error: 'Indica un número.' }).int('Debe ser entero.').min(-32768).max(32767),
  incluye_comida: z.boolean(),
  incluye_transporte: z.boolean(),
  incluye_guia: z.boolean(),
});
type CategoryValues = z.infer<typeof categorySchema>;

function CategoryDialog({ category, parents, onClose, onSaved }: { category: AdminCategory | null; parents: AdminCategory[]; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      nombre: category?.nombre ?? '',
      padre_id: category?.padre_id ?? '',
      slug: category?.slug ?? '',
      descripcion: category?.descripcion ?? '',
      icono: category?.icono ?? 'map-pin',
      orden: category?.orden ?? 0,
      incluye_comida: category?.incluye_comida ?? false,
      incluye_transporte: category?.incluye_transporte ?? false,
      incluye_guia: category?.incluye_guia ?? false,
    },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    const common = {
      nombre: v.nombre,
      icono: v.icono,
      orden: v.orden,
      incluye_comida: v.incluye_comida,
      incluye_transporte: v.incluye_transporte,
      incluye_guia: v.incluye_guia,
    };
    try {
      if (category) {
        await catalogApi.updateCategory(category.id, { ...common, descripcion: v.descripcion || null });
      } else {
        const slug = v.slug || slugify(v.nombre);
        await catalogApi.createCategory({ ...common, id: `cat-${slug}`.slice(0, 40), slug, ...(v.padre_id ? { padre_id: v.padre_id } : {}), ...(v.descripcion ? { descripcion: v.descripcion } : {}) });
      }
      notify('Categoría guardada.', 'success');
      onSaved();
    } catch (e) {
      setError(e);
    }
  });
  const err = (name: keyof CategoryValues) => errors[name]?.message ?? fieldError(error, name);
  const check = (name: 'incluye_comida' | 'incluye_transporte' | 'incluye_guia', label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="h-[18px] w-[18px] accent-[#C94D6B]" {...register(name)} /> {label}
    </label>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={category ? `Editar ${category.nombre}` : 'Nueva categoría'}
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
        <Input label="Nombre" error={err('nombre')} {...register('nombre')} />
        {category ? (
          <Input label="Slug" value={category.slug} disabled readOnly help="No cambia: rompería los enlaces." />
        ) : (
          <Input label="Slug (opcional)" help="Vacío, se genera del nombre. No se puede cambiar después." error={err('slug')} {...register('slug')} />
        )}
        {!category && (
          <Select
            label="Categoría padre (no cambia después)"
            className="sm:col-span-2"
            options={[{ value: '', label: 'Ninguna: categoría principal' }, ...parents.map((c) => ({ value: c.id, label: c.nombre }))]}
            {...register('padre_id')}
          />
        )}
        <TextArea label="Descripción (opcional)" className="sm:col-span-2" maxLength={255} rows={2} error={err('descripcion')} {...register('descripcion')} />
        <Input label="Icono" help="Nombre del icono, por ejemplo map-pin." error={err('icono')} {...register('icono')} />
        <Input label="Orden" inputMode="numeric" error={err('orden')} {...register('orden')} />
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          {check('incluye_comida', 'Incluye comida')}
          {check('incluye_transporte', 'Incluye transporte')}
          {check('incluye_guia', 'Incluye guía')}
        </div>
        {error !== null && (
          <div className="sm:col-span-2">
            <Alert tone="error">{errorMessage(error)}</Alert>
          </div>
        )}
      </form>
    </Modal>
  );
}

// Idiomas --------------------------------------------------------------------------

/** Idiomas que se pueden marcar en una atracción. El código ISO 639-1 no cambia. */
export function AdminLanguagesPage() {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<AdminLanguage | 'new' | null>(null);
  const { busy, run } = useRowAction(() => setReload((n) => n + 1), notify);

  const columns: Column<AdminLanguage>[] = [
    { header: 'Idioma', cell: (l) => <span className="font-semibold">{l.nombre}<Sub>{l.codigo}</Sub></span> },
    { header: 'Uso', cell: (l) => usage(l.atracciones) },
    {
      header: '',
      align: 'right',
      cell: (l) => (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setEditing(l)} aria-label={`Renombrar ${l.nombre}`}>
            <Pencil size={15} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            disabled={l.atracciones > 0}
            loading={busy === l.codigo}
            title={l.atracciones > 0 ? 'Quítalo primero de las atracciones que lo usan' : undefined}
            aria-label={`Quitar ${l.nombre}`}
            onClick={() => run(l.codigo, () => catalogApi.deleteLanguage(l.codigo), `${l.nombre} quitado.`)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Idiomas"
        load={async (p, signal) => pageOf(await catalogApi.adminLanguages(signal), p.page, p.limit)}
        columns={columns}
        rowKey={(l) => l.codigo}
        reloadKey={reload}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Nuevo idioma
          </Button>
        }
      />
      {editing && (
        <LanguageDialog
          language={editing === 'new' ? null : editing}
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

function LanguageDialog({ language, onClose, onSaved }: { language: AdminLanguage | null; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [codigo, setCodigo] = useState(language?.codigo ?? '');
  const [nombre, setNombre] = useState(language?.nombre ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const validCode = /^[a-zA-Z]{2}$/.test(codigo);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (language) await catalogApi.updateLanguage(language.codigo, nombre.trim());
      else await catalogApi.createLanguage(codigo.toLowerCase(), nombre.trim());
      notify('Idioma guardado.', 'success');
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
      title={language ? `Renombrar ${language.nombre}` : 'Nuevo idioma'}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!nombre.trim() || !validCode} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Código" maxLength={2} placeholder="pt" disabled={!!language} value={codigo} onChange={(e) => setCodigo(e.target.value.trim())} help="Dos letras, ISO 639-1. No cambia después." error={fieldError(error, 'codigo')} />
        <Input label="Nombre" maxLength={50} placeholder="Portugués" value={nombre} onChange={(e) => setNombre(e.target.value)} error={fieldError(error, 'nombre')} />
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}
