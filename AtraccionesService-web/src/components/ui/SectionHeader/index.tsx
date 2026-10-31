import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

interface Props {
  id?: string;
  title: string;
  subtitle?: string;
  action?: { label: string; to: string };
  children?: ReactNode;
}

export function SectionHeader({ id, title, subtitle, action, children }: Props) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="text-2xl sm:text-[28px]">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
      </div>
      {action && (
        <Link to={action.to} className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline underline-offset-4 hover:text-brand-500">
          {action.label} <ChevronRight size={16} aria-hidden="true" />
        </Link>
      )}
      {children}
    </div>
  );
}
