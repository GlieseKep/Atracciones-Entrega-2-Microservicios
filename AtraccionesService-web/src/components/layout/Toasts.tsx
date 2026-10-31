import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

/** Notificaciones globales anunciadas con aria-live. */
export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertCircle : Info;
        const color = t.tone === 'success' ? 'text-[#9FE0C1]' : t.tone === 'error' ? 'text-brand-300' : 'text-white';
        return (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="fade-in pointer-events-auto flex items-start gap-3 rounded-md bg-night px-4 py-3 text-sm text-white shadow-raised">
            <Icon size={18} className={`mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
            <p className="flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Cerrar notificación" className="rounded p-0.5 hover:bg-white/10">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
