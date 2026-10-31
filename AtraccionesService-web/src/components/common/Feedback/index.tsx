import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, LogIn, RefreshCw, SearchX } from 'lucide-react';
import { errorMessage, isApiError } from '@/utils/api';
import { Button } from '../Button';

/** Mensaje en línea con `aria-live` para éxito, error o información (plan §11–12). */
export function Alert({ tone = 'info', children, className = '' }: { tone?: 'info' | 'success' | 'error'; children: ReactNode; className?: string }) {
  const styles = {
    info: 'border-[#E8DCD0] bg-brand-50 text-ink',
    success: 'border-[#BFDCCD] bg-[#EEF7F2] text-success',
    error: 'border-[#EBC3C8] bg-[#FCEFF0] text-danger',
  }[tone];
  const Icon = { info: Info, success: CheckCircle2, error: AlertCircle }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-md border px-4 py-3 text-sm ${styles} ${className}`}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  onLogin?: () => void;
  className?: string;
}

/** Estado de error de una carga, con reintento o inicio de sesión según el tipo. */
export function ErrorState({ error, onRetry, onLogin, className = '' }: ErrorStateProps) {
  const needsLogin = isApiError(error, 'unauthenticated', 'sessionExpired');
  return (
    <div role="alert" className={`flex flex-col items-center rounded-md border border-line px-6 py-12 text-center ${className}`}>
      <AlertCircle size={36} className="text-danger" aria-hidden="true" />
      <p className="mt-3 max-w-md text-base font-semibold">{errorMessage(error)}</p>
      <div className="mt-5 flex gap-3">
        {needsLogin && onLogin && (
          <Button onClick={onLogin}>
            <LogIn size={18} aria-hidden="true" /> Iniciar sesión
          </Button>
        )}
        {onRetry && !needsLogin && (
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw size={18} aria-hidden="true" /> Volver a intentar
          </Button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed border-line px-6 py-14 text-center">
      <SearchX size={40} className="text-brand-400" aria-hidden="true" />
      <h3 className="mt-4 text-lg">{title}</h3>
      {children && <div className="mt-2 max-w-md text-ink-soft">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
