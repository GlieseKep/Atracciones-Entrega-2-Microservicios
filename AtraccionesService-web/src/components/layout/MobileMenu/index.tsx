import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CalendarCheck, LayoutDashboard, LogIn, LogOut, User, UserPlus, X } from 'lucide-react';
import { SearchBar } from '@/components/search/SearchBar';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
import { paths } from '@/utils/routes';
import { NAV_LINKS } from '../Navbar';
import { Logo } from '../Logo';

/** Menú lateral compacto para móvil (plan §13). */
export function MobileMenu() {
  const open = useUiStore((s) => s.mobileMenuOpen);
  const setOpen = useUiStore((s) => s.setMobileMenu);
  const { isAuthenticated, signIn, signUp, signOut, displayName, canManageCatalog } = useAuth();
  const location = useLocation();
  const isAdmin = isAuthenticated && canManageCatalog;

  useEffect(() => setOpen(false), [location.pathname, location.hash, setOpen]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, setOpen]);

  if (!open) return null;
  const row = 'flex items-center gap-3 rounded-sm px-3 py-3 text-base font-semibold hover:bg-surface';

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
      <button
        type="button"
        className="absolute inset-0 bg-night/50"
        aria-label="Cerrar menú"
        onClick={() => setOpen(false)}
      />
      <div className="fade-in absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col bg-white shadow-raised">
        <div className="flex items-center justify-between border-b border-line px-4 py-4">
          <Logo />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
            className="rounded-full p-2 hover:bg-surface"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!isAdmin && <SearchBar variant="compact" />}
          <nav aria-label="Principal móvil" className="mt-4 flex flex-col">
            {isAdmin ? (
              <>
                <Link to={paths.admin()} className={row}>
                  <LayoutDashboard size={20} aria-hidden="true" /> Administración
                </Link>
                <button type="button" onClick={signOut} className={`${row} text-left`}>
                  <LogOut size={20} aria-hidden="true" /> Cerrar sesión
                </button>
              </>
            ) : (
              <>
                {NAV_LINKS.map((link) => (
                  <Link key={link.to} to={link.to} className={row}>
                    {link.label}
                  </Link>
                ))}
                <hr className="my-3 border-line" />
                {isAuthenticated ? (
                  <>
                    <Link to={paths.profile('reservas')} className={row}>
                      <CalendarCheck size={20} aria-hidden="true" /> Mis reservas
                    </Link>
                    <Link to={paths.profile()} className={row}>
                      <User size={20} aria-hidden="true" /> {displayName}
                    </Link>
                    <button type="button" onClick={signOut} className={`${row} text-left`}>
                      <LogOut size={20} aria-hidden="true" /> Cerrar sesión
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => signIn()}
                      className={`${row} text-left text-brand-500`}
                    >
                      <LogIn size={20} aria-hidden="true" /> Iniciar sesión
                    </button>
                    <button type="button" onClick={() => signUp()} className={`${row} text-left`}>
                      <UserPlus size={20} aria-hidden="true" /> Crear cuenta
                    </button>
                  </>
                )}
              </>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}
