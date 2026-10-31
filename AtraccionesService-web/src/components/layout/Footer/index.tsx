import { Link } from 'react-router-dom';
import { Globe, Mail, Phone } from 'lucide-react';
import { PHOTO_CREDITS } from '@/features/attractions/demoCatalog';
import { Logo } from '../Logo';

const COLUMNS = [
  {
    title: 'Ayuda',
    links: [
      { label: 'Centro de ayuda', to: '/ayuda' },
      { label: 'Política de cancelación', to: '/ayuda#cancelacion' },
      { label: 'Pagos y facturación', to: '/ayuda#pagos' },
      { label: 'Contacto', to: '/ayuda#contacto' },
    ],
  },
  {
    title: 'Explora',
    links: [
      { label: 'Cosas que hacer en Quito', to: '/atracciones?ciudad=Quito' },
      { label: 'Excursiones de naturaleza', to: '/atracciones?categorias=Naturaleza' },
      { label: 'Tours culturales', to: '/atracciones?categorias=Cultura' },
      { label: 'Aventura en los Andes', to: '/atracciones?categorias=Aventura' },
    ],
  },
  {
    title: 'Acerca de',
    links: [
      { label: 'Quiénes somos', to: '/ayuda#nosotros' },
      { label: 'Términos de uso', to: '/ayuda#terminos' },
      { label: 'Privacidad', to: '/ayuda#privacidad' },
      { label: 'Cookies', to: '/ayuda#privacidad' },
    ],
  },
];

/** Pie de página gris claro en columnas, como el de Viator. */
export function Footer() {
  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="page-container grid gap-10 py-12 md:grid-cols-[1.2fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-ink-soft">
            Tours, entradas y experiencias fotogénicas en Ecuador, reservadas con disponibilidad verificada.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-ink-soft">
            <li className="flex items-center gap-2">
              <Mail size={16} aria-hidden="true" /> hola@tourgirls.example
            </li>
            <li className="flex items-center gap-2">
              <Phone size={16} aria-hidden="true" /> +593 2 000 0000
            </li>
          </ul>
          <div className="mt-5 flex gap-2">
            {['Instagram', 'Facebook', 'TikTok'].map((name) => (
              <a
                key={name}
                href="#"
                className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold hover:border-brand-500 hover:text-brand-500"
              >
                {name}
              </a>
            ))}
          </div>
        </div>
        {COLUMNS.map((col) => (
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
