import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { CalendarCheck, ChevronDown, Globe, LayoutDashboard, LogOut, Menu, User } from 'lucide-react';
import { SearchBar } from '@/components/search/SearchBar';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
import { paths } from '@/utils/routes';
import { Logo } from '../Logo';
import { MobileMenu } from '../MobileMenu';

export const NAV_LINKS = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/atracciones', label: 'Atracciones' },
  { to: '/#destinos', label: 'Destinos' },
  { to: '/#experiencias', label: 'Experiencias' },
  { to: '/#historias', label: 'Historias' },
];

/**
 * Cabecera tipo Viator: logo, buscador central, accesos con icono + texto (reservas, perfil)
 * y una segunda fila con la navegación principal. Una sesión de administración solo ve el acceso al panel:
 * no necesita la navegación de compra.
 */
export function Navbar() {
  const { isAuthenticated, displayName, signIn, signUp, signOut, canManageCatalog, status } = useAuth();
  const setMobileMenu = useUiStore((s) => s.setMobileMenu);
  const location = useLocation();
  const isAdmin = isAuthenticated && canManageCatalog;
  const showSearch = !isAdmin && location.pathname !== '/';

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-white focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <div className="page-container flex h-[72px] items-center gap-4 lg:gap-8">
        <Logo />

        <div className="hidden flex-1 md:block">{showSearch && <SearchBar variant="compact" />}</div>
        <div className="flex-1 md:hidden" />

        <nav aria-label="Accesos de cuenta" className="flex items-center gap-1">
          <span className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-ink lg:inline-flex">
            <Globe size={18} aria-hidden="true" /> ES · US$
          </span>
          {isAdmin && (
            <HeaderLink
              to={paths.admin()}
              icon={<LayoutDashboard size={20} aria-hidden="true" />}
              label="Panel"
            />
          )}
          {isAuthenticated && !isAdmin && (
            <HeaderLink
              to={paths.profile('reservas')}
              icon={<CalendarCheck size={20} aria-hidden="true" />}
              label="Mis reservas"
            />
          )}
          {isAuthenticated ? (
            <AccountMenu name={displayName} onSignOut={signOut} canManageCatalog={canManageCatalog} />
          ) : (
            <>
              <button
                type="button"
                onClick={() => signIn()}
                disabled={status === 'authenticating'}
                className="hidden flex-col items-center rounded-md px-3 py-1 text-xs font-semibold text-ink hover:bg-surface sm:flex"
              >
                <User size={20} aria-hidden="true" />
                Iniciar sesión
              </button>
              <button
                type="button"
                onClick={() => signUp()}
                disabled={status === 'authenticating'}
                className="ml-1 hidden rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 sm:inline-flex"
              >
                Crear cuenta
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setMobileMenu(true)}
            className="ml-1 inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface md:hidden"
            aria-label="Abrir menú"
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        </nav>
      </div>

      {!isAdmin && (
        <nav aria-label="Principal" className="hidden border-t border-line md:block">
          <ul className="page-container flex h-11 items-center gap-6 text-sm font-semibold">
            {NAV_LINKS.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `relative py-3 transition-colors hover:text-brand-500 ${isActive && !link.to.includes('#') ? 'text-brand-500 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand-500' : 'text-ink'}`
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
            {isAuthenticated && (
              <li>
                <NavLink to={paths.profile('reservas')} className="py-3 text-ink hover:text-brand-500">
                  Mis reservas
                </NavLink>
              </li>
            )}
          </ul>
        </nav>
      )}
      <MobileMenu />
    </header>
  );
}

function HeaderLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="relative hidden flex-col items-center rounded-md px-3 py-1 text-xs font-semibold text-ink hover:bg-surface sm:flex"
    >
      {icon}
      {label}
    </Link>
  );
}

function AccountMenu({
  name,
  onSignOut,
  canManageCatalog,
}: {
  name: string;
  onSignOut: () => void;
  canManageCatalog: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const initial = name.trim().charAt(0).toUpperCase() || 'U';
  const item = 'flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface';

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 hover:shadow-card"
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white"
          aria-hidden="true"
        >
          {initial}
        </span>
        <span className="max-w-[120px] truncate text-sm font-semibold">{name}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="fade-in absolute right-0 mt-2 w-60 overflow-hidden rounded-md border border-line bg-white py-1 shadow-raised"
        >
          {!canManageCatalog && (
            <>
              <Link role="menuitem" to={paths.profile()} className={item}>
                <User size={18} aria-hidden="true" /> Perfil
              </Link>
              <Link role="menuitem" to={paths.profile('reservas')} className={item}>
                <CalendarCheck size={18} aria-hidden="true" /> Reservas y pedidos
              </Link>
            </>
          )}
          {canManageCatalog && (
            <Link role="menuitem" to={paths.admin()} className={item}>
              <LayoutDashboard size={18} aria-hidden="true" /> Administración
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={onSignOut}
            className={`${item} w-full border-t border-line text-left`}
          >
            <LogOut size={18} aria-hidden="true" /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
