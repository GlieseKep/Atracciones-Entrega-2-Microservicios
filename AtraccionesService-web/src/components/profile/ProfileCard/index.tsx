import { BadgeCheck, Mail, MailWarning } from 'lucide-react';
import type { User } from '@/types/identity';
import { formatDateTime } from '@/utils/dates';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Administración', OPERADOR: 'Operador', CLIENTE: 'Cliente', GUIA: 'Guía' };

/** Tarjeta de identidad con los datos de ms-identity. */
export function ProfileCard({ user }: { user: User }) {
  const name = `${user.nombre} ${user.apellido}`.trim();
  return (
    <div className="card-surface flex items-center gap-4 p-5">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-500 text-2xl font-bold text-white" aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-bold">{name}</p>
        <p className="flex items-center gap-1.5 truncate text-sm text-ink-soft">
          <Mail size={14} aria-hidden="true" /> {user.correo}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          {user.verificado ? (
            <>
              <BadgeCheck size={14} className="text-success" aria-hidden="true" /> Correo verificado
            </>
          ) : (
            <>
              <MailWarning size={14} className="text-danger" aria-hidden="true" /> Correo sin verificar
            </>
          )}
          <span>· {user.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}</span>
          <span>· desde {formatDateTime(user.creado_en)}</span>
        </p>
      </div>
    </div>
  );
}
