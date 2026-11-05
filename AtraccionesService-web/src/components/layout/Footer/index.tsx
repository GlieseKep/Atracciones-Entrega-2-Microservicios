import { Link } from 'react-router-dom';
import { Globe, MessageCircle } from 'lucide-react';
import { serializeFilters } from '@/features/attractions/filters';
import { PHOTO_CREDITS } from '@/features/content/photos';
import { useCategories } from '@/hooks/useAttractions';
import { paths } from '@/utils/routes';
import { Logo } from '../Logo';

const HELP = [
  { label: 'Centro de ayuda', to: paths.help() },
  { label: 'Política de cancelación', to: paths.help('cancelacion') },
  { label: 'Pagos y facturación', to: paths.help('pagos') },
  { label: 'Contacto', to: paths.help('contacto') },
];

const ABOUT = [
  { label: 'Quiénes somos', to: paths.help('nosotros') },
  { label: 'Términos de uso', to: paths.help('terminos') },
  { label: 'Privacidad y cookies', to: paths.help('privacidad') },
];

/** Pie de página en columnas. "Explora" usa las categorías de ms-catalog, así que sus enlaces siempre filtran. */
export function Footer() {
  const categories = useCategories();
  const explore = [
    { label: 'Todas las experiencias', to: paths.attractions() },
    ...(categories.data ?? []).slice(0, 4).map((c) => ({ label: c.nombre, to: paths.attractions(serializeFilters({ category: c.id })) })),
  ];
  const columns = [
    { title: 'Ayuda', links: HELP },
    { title: 'Explora', links: explore },
    { title: 'Acerca de', links: ABOUT },
  ];

  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="page-container grid gap-10 py-12 md:grid-cols-[1.2fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-ink-soft">Tours, entradas y experiencias en Ecuador, con cupos verificados en tiempo real.</p>
          <Link to={paths.help('contacto')} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-brand-500">
            <MessageCircle size={16} aria-hidden="true" /> Escríbenos
          </Link>
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-base">{col.title}</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link to={link.to} className="text-ink-soft hover:text-brand-500 hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="page-container flex flex-col gap-3 py-5 text-xs text-ink-muted md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} TourGirls · Proyecto académico de Integración de Sistemas.</p>
          <p className="max-w-xl">{PHOTO_CREDITS}</p>
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Globe size={14} aria-hidden="true" /> Español · US$
          </span>
        </div>
      </div>
    </footer>
  );
}
