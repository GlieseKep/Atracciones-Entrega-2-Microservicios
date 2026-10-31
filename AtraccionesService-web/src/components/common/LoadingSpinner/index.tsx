import { Loader2 } from 'lucide-react';

interface Props {
  size?: number;
  /** Texto para lectores de pantalla; vacío cuando el spinner acompaña a otro texto. */
  label?: string;
  className?: string;
}

export function LoadingSpinner({ size = 24, label = 'Cargando…', className = '' }: Props) {
  return (
    <span role={label ? 'status' : undefined} className={`inline-flex items-center gap-2 ${className}`}>
      <Loader2 size={size} className="animate-spin" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
