import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange, Plus, UserRound, Users } from 'lucide-react';
import { catalogApi, collectPages, inventoryApi, pageOf } from '@/api/admin';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert, EmptyState, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { useAsync } from '@/hooks/useAsync';
import { useUiStore } from '@/stores/uiStore';
import type { AdminAttraction, BlockedDate, Guide, Schedule, Slot } from '@/types/admin';
import { errorMessage } from '@/utils/api';
import { addDays, formatDate, today } from '@/utils/dates';
import { AdminTable, Sub, useRowAction, type Column } from './AdminTable';

const TABS = [
  { id: 'turnos', label: 'Turnos' },
  { id: 'horarios', label: 'Horarios' },
  { id: 'bloqueos', label: 'Días bloqueados' },
] as const;

/** Los turnos se generan 90 días hacia adelante (ms-inventory). */
const WINDOW_DAYS = 90;
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const shortTime = (hora: string) => hora.slice(0, 5);

/** `gui_id` para "sin guía": la compra no asigna ninguno. `0`/`null` es automático (el del horario o el primero activo). */
const NO_GUIDE = -1;

function guideText(guiId: number | null, guides: Guide[]) {
  if (guiId === NO_GUIDE) return <span className="text-ink-muted">Sin guía</span>;
  if (guiId === null || guiId === 0) return <span className="text-ink-muted">Automático</span>;
  const guide = guides.find((g) => g.gui_id === guiId);
  if (!guide) return <span className="text-ink-muted">Guía {guiId}</span>;
  return guide.activo ? guide.nombre : <span className="text-danger">{guide.nombre} (inactivo)</span>;
}

/**
 * Horarios y turnos de ms-inventory. El horario guarda el guía por defecto; cada turno puede tener otro, por día o por
 * rango de fechas (`Plan/PLAN_GUIA_POR_HORARIO.md`).
 */
export default function AdminAvailabilityPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('atraccion') ?? '';
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('turnos');
  const attractions = useAsync((signal) => collectPages((page) => catalogApi.list({ page, limit: 50 }, signal)), []);
  const items = useMemo(() => attractions.data?.items ?? [], [attractions.data]);
  const attraction = items.find((a) => a.id === selectedId) ?? null;
  const guides = useAsync((signal) => catalogApi.guides({ operador: attraction?.operador }, signal), [attraction?.operador], !!attraction);

  useEffect(() => {
    if (!selectedId && items[0]) setParams({ atraccion: items[0].id }, { replace: true });
  }, [items, selectedId, setParams]);

  return (
    <div>
      <h1 className="text-3xl">Disponibilidad</h1>
      {attractions.status === 'error' ? (
        <ErrorState error={attractions.error} onRetry={attractions.retry} className="mt-6" />
      ) : !attractions.data ? (
        <div className="skeleton mt-6 h-72" aria-busy="true" />
      ) : items.length === 0 ? (
        <EmptyState title="Todavía no hay atracciones">Crea una en Catálogo para definir sus horarios.</EmptyState>
      ) : (
        <>
          <div className="mt-5 max-w-xl">
            <Select
              label="Atracción"
              value={selectedId}
              onChange={(e) => setParams({ atraccion: e.target.value })}
              options={items.map((a) => ({ value: a.id, label: `${a.name}${a.estado === 'PUBLICADA' ? '' : ` (${a.estado.toLowerCase()})`}` }))}
            />
          </div>
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
          {attraction && (
            <div className="mt-2" key={attraction.id}>
              {tab === 'turnos' && <SlotsTab attraction={attraction} guides={guides.data ?? []} />}
              {tab === 'horarios' && <SchedulesTab attraction={attraction} guides={guides.data ?? []} />}
              {tab === 'bloqueos' && <BlockedTab attraction={attraction} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SlotsTab({ attraction, guides }: { attraction: AdminAttraction; guides: Guide[] }) {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [capacity, setCapacity] = useState<Slot | null>(null);
  const [guideFor, setGuideFor] = useState<Slot | null>(null);
  const [range, setRange] = useState(false);
  const refresh = () => setReload((n) => n + 1);
  const { busy, run } = useRowAction(refresh, notify);

  const columns: Column<Slot>[] = [
    { header: 'Fecha', cell: (s) => <span className="font-semibold">{formatDate(s.fecha)}<Sub>{s.slot_id}</Sub></span> },
    { header: 'Hora', cell: (s) => shortTime(s.hora) },
    { header: 'Cupos', cell: (s) => <span>{s.cupo_reservado} / {s.cupo_total}<Sub>{s.cupo_total - s.cupo_reservado} libres</Sub></span> },
    { header: 'Guía', cell: (s) => guideText(s.gui_id, guides) },
    { header: 'Estado', cell: (s) => <Badge tone={s.cerrada ? 'danger' : 'success'}>{s.cerrada ? 'Cerrado' : 'Abierto'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (s) => (
        <span className="inline-flex gap-1">
          <Button size="sm" variant="tertiary" onClick={() => setGuideFor(s)} aria-label={`Cambiar guía del ${s.fecha}`}>
            <UserRound size={15} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="tertiary" onClick={() => setCapacity(s)} aria-label={`Cambiar cupo del ${s.fecha}`}>
            <Users size={15} aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === s.slot_id}
            onClick={() => run(s.slot_id, () => inventoryApi.setClosed(attraction.id, s.slot_id, !s.cerrada), s.cerrada ? 'Turno abierto.' : 'Turno cerrado.')}
          >
            {s.cerrada ? 'Abrir' : 'Cerrar'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Turnos"
        hideTitle
        load={(p, signal) => inventoryApi.slots({ page: p.page, limit: p.limit, atraccion_id: attraction.id, desde: p.from ?? today(), hasta: p.to }, signal)}
        columns={columns}
        rowKey={(s) => s.slot_id}
        dateLabel="Fecha"
        reloadKey={reload}
        actions={
          <Button variant="secondary" onClick={() => setRange(true)}>
            <CalendarRange size={16} aria-hidden="true" /> Asignar guía a un rango
          </Button>
        }
      />
      {capacity && <CapacityDialog slot={capacity} onClose={() => setCapacity(null)} onSaved={() => { setCapacity(null); refresh(); }} />}
      {guideFor && <SlotGuideDialog slot={guideFor} guides={guides} onClose={() => setGuideFor(null)} onSaved={() => { setGuideFor(null); refresh(); }} />}
      {range && <RangeGuideDialog attraction={attraction} guides={guides} onClose={() => setRange(false)} onSaved={() => { setRange(false); refresh(); }} />}
    </>
  );
}

function CapacityDialog({ slot, onClose, onSaved }: { slot: Slot; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [value, setValue] = useState(String(slot.cupo_total));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cupo = Number(value);
  const valid = Number.isInteger(cupo) && cupo >= Math.max(1, slot.cupo_reservado);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await inventoryApi.setCapacity(slot.atraccion_id, slot.slot_id, cupo);
      notify('Cupo actualizado.', 'success');
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
      title={`Cupo del ${formatDate(slot.fecha)}, ${shortTime(slot.hora)}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!valid} onClick={save}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Cupo total"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          help={`Ya hay ${slot.cupo_reservado} reservados: no puede ser menor.`}
          error={valid ? undefined : `Debe ser un entero de ${Math.max(1, slot.cupo_reservado)} o más.`}
        />
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}

const activeGuideOptions = (guides: Guide[], none: string) => [
  { value: '0', label: none },
  { value: String(NO_GUIDE), label: 'Sin guía' },
  ...guides.filter((g) => g.activo).map((g) => ({ value: String(g.gui_id), label: `${g.nombre} (${g.codigo})` })),
];

function SlotGuideDialog({ slot, guides, onClose, onSaved }: { slot: Slot; guides: Guide[]; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [guide, setGuide] = useState(slot.gui_id ? String(slot.gui_id) : '0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await inventoryApi.setSlotGuide(slot.atraccion_id, slot.slot_id, Number(guide));
      notify('Guía del turno actualizado.', 'success');
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
      title={`Guía del ${formatDate(slot.fecha)}, ${shortTime(slot.hora)}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={save}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Guía (opcional)" value={guide} onChange={(e) => setGuide(e.target.value)} options={activeGuideOptions(guides, 'Volver al guía del horario')} />
        {slot.cupo_reservado > 0 && <Alert>Este turno ya tiene {slot.cupo_reservado} cupos reservados: esas reservas conservan su guía actual.</Alert>}
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}

function RangeGuideDialog({ attraction, guides, onClose, onSaved }: { attraction: AdminAttraction; guides: Guide[]; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const schedules = useAsync((signal) => inventoryApi.schedules(attraction.id, signal), [attraction.id]);
  const [guide, setGuide] = useState('0');
  const [desde, setDesde] = useState(today());
  const [hasta, setHasta] = useState(addDays(today(), 30));
  const [horId, setHorId] = useState('0');
  const [dias, setDias] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const limit = addDays(today(), WINDOW_DAYS);
  const valid = !!desde && !!hasta && desde >= today() && desde <= hasta && hasta <= limit;
  const scheduleHour = schedules.data?.find((s) => String(s.hor_id) === horId)?.hora;

  // Vista previa: qué turnos cambiarán y cuántos ya tienen reservas.
  const filterKey = `${desde}|${hasta}|${horId}|${dias.join(',')}`;
  const preview = useAsync(
    async (signal) => {
      const slots: Slot[] = [];
      for (let page = 1; ; page++) {
        const result = await inventoryApi.slots({ page, limit: 200, atraccion_id: attraction.id, desde, hasta }, signal);
        slots.push(...result.items);
        if (slots.length >= result.total || result.items.length === 0) break;
      }
      const matches = slots.filter((s) => {
        const iso = ((new Date(`${s.fecha}T12:00:00`).getDay() + 6) % 7) + 1;
        return (dias.length === 0 || dias.includes(iso)) && (!scheduleHour || s.hora === scheduleHour);
      });
      return { total: matches.length, reserved: matches.filter((s) => s.cupo_reservado > 0).length };
    },
    [filterKey, scheduleHour],
    valid,
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await inventoryApi.setSlotsGuide({ atraccion_id: attraction.id, desde, hasta, hor_id: Number(horId), dias_semana: dias, gui_id: Number(guide) });
      notify(`${result.actualizados} turnos actualizados.${result.con_reservas ? ` ${result.con_reservas} tienen reservas, que conservan su guía.` : ''}`, 'success');
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
      onClose={onClose}
      title="Asignar guía a un rango"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!valid} onClick={save}>Asignar</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Guía (opcional)" value={guide} onChange={(e) => setGuide(e.target.value)} options={activeGuideOptions(guides, 'Volver al guía de cada horario')} />
        <Select
          label="Horario"
          value={horId}
          onChange={(e) => setHorId(e.target.value)}
          options={[{ value: '0', label: 'Todos' }, ...(schedules.data ?? []).map((s) => ({ value: String(s.hor_id), label: shortTime(s.hora) }))]}
        />
        <Input label="Desde" type="date" min={today()} max={limit} value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Input label="Hasta" type="date" min={desde} max={limit} value={hasta} onChange={(e) => setHasta(e.target.value)} help={`Hay turnos hasta el ${formatDate(limit)}.`} />
        <fieldset className="sm:col-span-2">
          <legend className="field-label">Días de la semana (ninguno = todos)</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((label, i) => (
              <label key={label} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] accent-[#C94D6B]"
                  checked={dias.includes(i + 1)}
                  onChange={(e) => setDias((list) => (e.target.checked ? [...list, i + 1] : list.filter((d) => d !== i + 1)))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-3 sm:col-span-2">
          {!valid ? (
            <Alert tone="error">Revisa las fechas: desde hoy hasta {formatDate(limit)}, y «Desde» no puede ser posterior a «Hasta».</Alert>
          ) : preview.data ? (
            <Alert>
              Cambiarán {preview.data.total} turnos.
              {preview.data.reserved > 0 && ` ${preview.data.reserved} ya tienen reservas: esas reservas conservan su guía actual.`} Los cambios hechos a días sueltos dentro del rango se reemplazan.
            </Alert>
          ) : null}
          {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
        </div>
      </div>
    </Modal>
  );
}

function SchedulesTab({ attraction, guides }: { attraction: AdminAttraction; guides: Guide[] }) {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const refresh = () => setReload((n) => n + 1);
  const { busy, run } = useRowAction(refresh, notify);

  const columns: Column<Schedule>[] = [
    { header: 'Hora', cell: (s) => <strong>{shortTime(s.hora)}</strong> },
    { header: 'Cupo', cell: (s) => s.cupo },
    { header: 'Guía por defecto', cell: (s) => guideText(s.gui_id, guides) },
    { header: 'Estado', cell: (s) => <Badge tone={s.activo ? 'success' : 'neutral'}>{s.activo ? 'Activo' : 'Inactivo'}</Badge> },
    {
      header: '',
      align: 'right',
      cell: (s) => (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setEditing(s)}>
            Editar
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === String(s.hor_id)}
            onClick={() =>
              run(
                String(s.hor_id),
                () => inventoryApi.setScheduleActive(s.hor_id, !s.activo),
                s.activo ? 'Horario desactivado: no se generan más turnos; los existentes siguen.' : 'Horario activado. Los turnos nuevos nacen con el guía del horario.',
              )
            }
          >
            {s.activo ? 'Desactivar' : 'Activar'}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Horarios"
        hideTitle
        load={async (p, signal) => pageOf(await inventoryApi.schedules(attraction.id, signal), p.page, p.limit)}
        columns={columns}
        rowKey={(s) => String(s.hor_id)}
        reloadKey={reload}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Nuevo horario
          </Button>
        }
      />
      {editing && (
        <ScheduleDialog
          attraction={attraction}
          schedule={editing === 'new' ? null : editing}
          guides={guides}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function ScheduleDialog({
  attraction,
  schedule,
  guides,
  onClose,
  onSaved,
}: {
  attraction: AdminAttraction;
  schedule: Schedule | null;
  guides: Guide[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useUiStore((s) => s.notify);
  const [hora, setHora] = useState(schedule ? shortTime(schedule.hora) : '09:00');
  const [cupo, setCupo] = useState(String(schedule?.cupo ?? 20));
  const [guide, setGuide] = useState(schedule?.gui_id ? String(schedule.gui_id) : '0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cupoValue = Number(cupo);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(hora) && Number.isInteger(cupoValue) && cupoValue > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await inventoryApi.saveSchedule({ hor_id: schedule?.hor_id ?? 0, atraccion_id: attraction.id, hora: `${hora}:00`, cupo: cupoValue, gui_id: Number(guide) });
      notify(schedule ? 'Horario actualizado.' : 'Horario creado: se generaron sus turnos para los próximos 90 días.', 'success');
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
      title={schedule ? `Horario de las ${shortTime(schedule.hora)}` : 'Nuevo horario'}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!valid} onClick={save}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Hora"
          type="time"
          disabled={!!schedule}
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          help={schedule ? 'La hora no cambia: crea otro horario y desactiva este.' : undefined}
        />
        <Input label="Cupo por turno" inputMode="numeric" value={cupo} onChange={(e) => setCupo(e.target.value)} help={schedule ? 'Rige para los turnos nuevos; cada turno se ajusta aparte.' : undefined} />
        <Select
          label="Guía por defecto (opcional)"
          value={guide}
          onChange={(e) => setGuide(e.target.value)}
          options={activeGuideOptions(guides, 'Automático (el primero activo del operador)')}
        />
        {schedule && <p className="text-xs text-ink-muted">Un guía nuevo pasa a los turnos futuros que tenían el anterior; los días cambiados a mano se respetan.</p>}
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      </div>
    </Modal>
  );
}

function BlockedTab({ attraction }: { attraction: AdminAttraction }) {
  const notify = useUiStore((s) => s.notify);
  const [reload, setReload] = useState(0);
  const [fecha, setFecha] = useState('');
  const [motivo, setMotivo] = useState('');
  const refresh = () => setReload((n) => n + 1);
  const { busy, run } = useRowAction(refresh, notify);

  const columns: Column<BlockedDate>[] = [
    { header: 'Fecha', cell: (b) => <strong>{formatDate(b.fecha)}</strong> },
    { header: 'Motivo', cell: (b) => b.motivo },
    {
      header: '',
      align: 'right',
      cell: (b) => (
        <Button size="sm" variant="secondary" loading={busy === b.fecha} onClick={() => run(b.fecha, () => inventoryApi.unblockDate(attraction.id, b.fecha), 'Fecha desbloqueada: sus turnos se reabrieron.')}>
          Desbloquear
        </Button>
      ),
    },
  ];

  return (
    <div>
      <form
        className="card-surface mt-4 grid gap-3 p-4 sm:grid-cols-[180px_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          await run('new', () => inventoryApi.blockDate(attraction.id, fecha, motivo.trim()), 'Fecha bloqueada: sus turnos quedaron cerrados.');
          setFecha('');
          setMotivo('');
        }}
      >
        <Input label="Fecha" type="date" min={today()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <Input label="Motivo" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Feriado, clima, mantenimiento…" />
        <Button type="submit" loading={busy === 'new'} disabled={!fecha || !motivo.trim()}>
          Bloquear
        </Button>
      </form>
      <p className="mt-2 text-xs text-ink-muted">Cierra los turnos del día; las reservas existentes siguen vigentes.</p>
      <AdminTable
        title="Días bloqueados"
        hideTitle
        load={async (p, signal) => pageOf(await inventoryApi.blockedDates(attraction.id, signal), p.page, p.limit)}
        columns={columns}
        rowKey={(b) => b.fecha}
        reloadKey={reload}
      />
    </div>
  );
}
