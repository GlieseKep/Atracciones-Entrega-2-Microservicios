import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { adminApi, type AdminSlot } from '@/api/admin';
import { listAttractions } from '@/api/attractions';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { IconButton } from '@/components/common/IconButton';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { useAsync } from '@/hooks/useAsync';
import { useUiStore } from '@/stores/uiStore';
import { errorMessage } from '@/utils/api';
import { formatDate, isValidLocalTime, today } from '@/utils/dates';
import { AdminTable, Sub, type Column } from './AdminTable';

const MAX_CAPACITY = 10_000;

function Occupancy({ slot }: { slot: AdminSlot }) {
  const pct = slot.capacity ? Math.round((slot.reserved / slot.capacity) * 100) : 100;
  const full = slot.reserved >= slot.capacity;
  return (
    <div className="min-w-[140px]">
      <div className="flex justify-between text-xs">
        <span>{slot.reserved} / {slot.capacity}</span>
        {full ? <Badge tone="danger">Agotada</Badge> : <span className="text-ink-muted">{slot.capacity - slot.reserved} libres</span>}
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface" aria-hidden="true">
        <div className={`h-1.5 rounded-full ${full ? 'bg-danger' : 'bg-brand-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

/** Franjas por atracción y fecha: ocupación, ajuste de capacidad (nunca por debajo de lo reservado) y alta de franjas. */
export default function AdminAvailabilityPage() {
  const attractions = useAsync((signal) => listAttractions(100, 0, signal), []);
  const [attractionId, setAttractionId] = useState('');
  const [editing, setEditing] = useState<AdminSlot | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const options = (attractions.data?.data ?? []).map((a) => ({ value: a.id, label: a.name }));

  const columns: Column<AdminSlot>[] = [
    { header: 'Atracción', cell: (s) => <span className="font-semibold">{s.attractionName}</span> },
    { header: 'Fecha', cell: (s) => <>{formatDate(s.date)}<Sub>{s.date}</Sub></> },
    { header: 'Hora', cell: (s) => s.time },
    { header: 'Ocupación', cell: (s) => <Occupancy slot={s} /> },
    {
      header: 'Acciones',
      align: 'right',
      cell: (s) => (
        <IconButton aria-label={`Cambiar capacidad del ${s.date} a las ${s.time}`} icon={<Pencil size={16} aria-hidden="true" />} onClick={() => setEditing(s)} />
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Disponibilidad"
        load={adminApi.availability}
        columns={columns}
        rowKey={(s) => s.id}
        searchPlaceholder="Nombre de la atracción"
        statuses={[
          { value: 'AVAILABLE', label: 'Con cupos' },
          { value: 'FULL', label: 'Agotadas' },
        ]}
        dateLabel="Fecha"
        extraFilters={
          <Select
            label="Atracción"
            value={attractionId}
            onChange={(e) => setAttractionId(e.target.value)}
            options={[{ value: '', label: 'Todas' }, ...options]}
          />
        }
        extraParams={attractionId ? { attractionId } : undefined}
        reloadKey={reloadKey}
        pageSize={20}
        actions={
          <Button onClick={() => setCreating(true)} disabled={!options.length}>
            <Plus size={18} aria-hidden="true" /> Nueva franja
          </Button>
        }
      />
      {editing && (
        <CapacityDialog
          slot={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadKey((n) => n + 1);
          }}
        />
      )}
      {creating && (
        <NewSlotDialog
          attractions={options}
          defaultAttraction={attractionId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setReloadKey((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function CapacityDialog({ slot, onClose, onSaved }: { slot: AdminSlot; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [capacity, setCapacity] = useState(String(slot.capacity));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = Number(capacity);
  const invalid = !Number.isInteger(value) || value < slot.reserved || value > MAX_CAPACITY;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateCapacity(slot.id, value);
      notify('Capacidad actualizada.', 'success');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="sm"
      title="Cambiar capacidad"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy || invalid}>Guardar</Button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">
        {slot.attractionName} · {formatDate(slot.date)} · {slot.time}
      </p>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      <Input
        className="mt-4"
        label="Capacidad"
        type="number"
        min={slot.reserved}
        max={MAX_CAPACITY}
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
        help={`Ya hay ${slot.reserved} cupos reservados: la capacidad no puede ser menor.`}
        error={capacity !== '' && invalid ? `Debe ser un entero entre ${slot.reserved} y ${MAX_CAPACITY}.` : undefined}
      />
    </Modal>
  );
}

interface NewSlotProps {
  attractions: { value: string; label: string }[];
  defaultAttraction: string;
  onClose: () => void;
  onSaved: () => void;
}

function NewSlotDialog({ attractions, defaultAttraction, onClose, onSaved }: NewSlotProps) {
  const notify = useUiStore((s) => s.notify);
  const [attractionId, setAttractionId] = useState(defaultAttraction || attractions[0]?.value || '');
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('10:00');
  const [capacity, setCapacity] = useState('20');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cap = Number(capacity);
  const invalid = !attractionId || date < today() || !isValidLocalTime(time) || !Number.isInteger(cap) || cap < 0 || cap > MAX_CAPACITY;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.addSlot({ attractionId, date, time, capacity: cap });
      notify('Franja creada.', 'success');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Nueva franja"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy || invalid}>Crear franja</Button>
        </>
      }
    >
      {error && <Alert tone="error" className="mb-3">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select className="sm:col-span-2" label="Atracción" value={attractionId} onChange={(e) => setAttractionId(e.target.value)} options={attractions} />
        <Input label="Fecha" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <Input label="Capacidad" type="number" min={0} max={MAX_CAPACITY} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </div>
    </Modal>
  );
}
