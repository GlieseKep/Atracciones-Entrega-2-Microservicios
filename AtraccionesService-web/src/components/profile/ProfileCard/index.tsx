import { BadgeCheck, Mail } from 'lucide-react';
import type { SessionClaims } from '@/stores/authStore';
import type { User } from '@/types/identity';
import { formatDateTime } from '@/utils/dates';

/** Tarjeta de identidad: datos que vienen del token y del perfil local, sin información sensible. */
export function ProfileCard({ claims, user }: { claims: SessionClaims | null; user: User | null }) {
  const name = claims?.name ?? claims?.email ?? user?.email ?? 'Viajero';
  return (
    <div className="card-surface flex items-center gap-4 p-5">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-500 text-2xl font-bold text-white" aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-bold">{name}</p>
        {(user?.email ?? claims?.email) && (
          <p className="flex items-center gap-1.5 truncate text-sm text-ink-soft">
            <Mail size={14} aria-hidden="true" /> {user?.email ?? claims?.email}
          </p>
        )}
        {user && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
            <BadgeCheck size={14} className="text-success" aria-hidden="true" /> Cuenta {user.status === 'ACTIVE' ? 'activa' : user.status.toLowerCase()} · desde{' '}
            {formatDateTime(user.createdAt)}
          </p>
        )}
      </div>
    </div>
  );
}
