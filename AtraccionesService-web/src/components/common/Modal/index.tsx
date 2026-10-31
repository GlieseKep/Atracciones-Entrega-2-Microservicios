import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/** Diálogo accesible basado en <dialog>: foco atrapado, Escape y retorno del foco los gestiona el navegador. */
export function Modal({ open, title, onClose, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-3xl' }[size];

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`w-[calc(100%-2rem)] ${width} rounded-lg p-0 text-ink shadow-raised backdrop:bg-night/60`}
    >
      {open && (
        <div className="fade-in">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 id={titleId} className="text-lg">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded-full p-1.5 text-ink-soft hover:bg-surface"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
