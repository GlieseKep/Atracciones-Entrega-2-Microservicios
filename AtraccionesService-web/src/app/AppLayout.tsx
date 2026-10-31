import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Footer } from '@/components/layout/Footer';
import { LoginPrompt } from '@/components/layout/LoginPrompt';
import { Navbar } from '@/components/layout/Navbar';
import { Toasts } from '@/components/layout/Toasts';

/** Estructura común: cabecera, contenido con carga diferida, pie, notificaciones y diálogo de login. */
export function AppLayout() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main id="contenido" className="flex-1 pb-20 lg:pb-0">
        <Suspense
          fallback={
            <div className="flex min-h-[50vh] items-center justify-center text-brand-500">
              <LoadingSpinner size={32} />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <Toasts />
      <LoginPrompt />
    </div>
  );
}
