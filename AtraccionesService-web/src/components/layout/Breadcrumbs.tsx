import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

/** Migas de pan: Inicio › Sudamérica › Ecuador › Quito */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Ruta de navegación" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-ink-soft">
        {items.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && <ChevronRight size={14} aria-hidden="true" className="text-ink-muted" />}
            <li>
              {item.to && i < items.length - 1 ? (
                <Link to={item.to} className="underline-offset-2 hover:text-brand-500 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={i === items.length - 1 ? 'page' : undefined} className="text-ink">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
