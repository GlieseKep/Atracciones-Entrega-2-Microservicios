import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'overlay';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-ink',
  brand: 'bg-brand-100 text-brand-700',
  success: 'bg-[#E3F1EA] text-success',
  warning: 'bg-[#FBF0DD] text-[#7A5418]',
  danger: 'bg-[#F8E1E3] text-danger',
  overlay: 'bg-white text-ink shadow-card',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Tono de badge según el nombre que viene del catálogo. */
export function badgeTone(name: string): BadgeTone {
  const n = name.toLowerCase();
  if (n.includes('agotarse')) return 'warning';
  if (n.includes('nuevo')) return 'success';
  return 'overlay';
}
