import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { usersApi } from '@/api/admin';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useAsync } from '@/hooks/useAsync';
import type { RoleName } from '@/types/identity';
import { errorMessage } from '@/utils/api';

interface Props {
  label: string;
  help?: string;
  value: number | null;
  onChange: (id: number | null) => void;
  /** Busca solo entre los usuarios con este rol. */
  rol?: RoleName;
}

/** Elige un usuario buscándolo por nombre o correo, en lugar de escribir su ID. */
export function UserPicker({ label, help, value, onChange, rol }: Props) {
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const selected = useAsync((signal) => usersApi.get(value as number, signal), [value], value !== null);
  const results = useAsync((signal) => usersApi.list({ page: 1, limit: 6, q, rol }, signal), [q, rol], value === null && q.length >= 2);

  if (value !== null) {
    const user = selected.data;
    return (
      <div>
        <p className="field-label">{label}</p>
        <div className="flex items-center justify-between gap-3 rounded-md border border-line p-3 text-sm">
          <span>
            {user ? (
              <>
                <span className="font-semibold">
                  {user.nombre} {user.apellido}
                </span>
                <span className="block text-xs text-ink-muted">{user.correo}</span>
              </>
            ) : selected.status === 'error' ? (
              `Usuario ${value}`
            ) : (
              'Cargando…'
            )}
          </span>
          <Button type="button" size="sm" variant="tertiary" onClick={() => onChange(null)} aria-label="Quitar usuario">
            <X size={15} aria-hidden="true" />
          </Button>
        </div>
        {help && <p className="field-help">{help}</p>}
      </div>
    );
  }

  return (
    <div>
      <Input label={label} type="search" placeholder="Nombre o correo" value={typed} onChange={(e) => setTyped(e.target.value)} icon={<Search size={16} />} help={help} maxLength={100} />
      {q.length >= 2 && (
        <ul className="mt-2 divide-y divide-line rounded-md border border-line text-sm">
          {results.status === 'error' ? (
            <li className="p-3 text-danger">{errorMessage(results.error)}</li>
          ) : !results.data ? (
            <li className="p-3 text-ink-muted">Buscando…</li>
          ) : results.data.items.length === 0 ? (
            <li className="p-3 text-ink-muted">Sin resultados{rol ? ` con ese rol` : ''}.</li>
          ) : (
            results.data.items.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  className="w-full p-3 text-left hover:bg-surface"
                  onClick={() => {
                    setTyped('');
                    setQ('');
                    onChange(user.id);
                  }}
                >
                  <span className="font-semibold">
                    {user.nombre} {user.apellido}
                  </span>
                  <span className="block text-xs text-ink-muted">{user.correo}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
