import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { LoadingSpinner } from '../LoadingSpinner';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'dark';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#ECE8E9] disabled:text-ink-muted';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700',
  secondary: 'border border-brand-500 bg-white text-brand-500 hover:bg-brand-50',
  tertiary: 'bg-transparent text-ink hover:bg-brand-50',
  danger: 'border border-danger bg-white text-danger hover:bg-danger hover:text-white',
  dark: 'bg-ink text-white hover:bg-night',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-[15px]',
  lg: 'px-6 py-3.5 text-base',
};

export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = '') =>
  `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, fullWidth = false, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, `${fullWidth ? 'w-full' : ''} ${className}`)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <LoadingSpinner size={16} label="" />}
      {children}
    </button>
  );
});

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function ButtonLink({ variant = 'primary', size = 'md', fullWidth, className = '', ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, `${fullWidth ? 'w-full' : ''} ${className}`)} {...rest} />;
}
