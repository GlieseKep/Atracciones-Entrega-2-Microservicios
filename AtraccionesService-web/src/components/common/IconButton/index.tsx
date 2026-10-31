import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Obligatorio: los iconos interactivos necesitan nombre accesible (plan §12). */
  'aria-label': string;
  icon: ReactNode;
  variant?: 'plain' | 'floating';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = 'plain', className = '', type = 'button', ...rest },
  ref,
) {
  const style =
    variant === 'floating'
      ? 'bg-white/95 shadow-card hover:bg-white hover:scale-105'
      : 'hover:bg-surface';
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-ink transition ${style} ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
});
