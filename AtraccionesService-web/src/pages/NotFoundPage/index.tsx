import { Compass } from 'lucide-react';
import { ButtonLink } from '@/components/common/Button';
import { paths } from '@/utils/routes';

export default function NotFoundPage() {
  return (
    <div className="page-container flex min-h-[55vh] flex-col items-center justify-center text-center">
      <Compass size={56} className="text-brand-400" aria-hidden="true" />
      <h1 className="mt-4 text-3xl">No encontramos esta página</h1>
      <p className="mt-2 max-w-md text-ink-soft">Puede que el enlace haya cambiado o que la experiencia ya no esté disponible.</p>
      <div className="mt-6 flex gap-3">
        <ButtonLink to={paths.home()}>Ir al inicio</ButtonLink>
        <ButtonLink to={paths.attractions()} variant="secondary">
          Ver experiencias
        </ButtonLink>
      </div>
    </div>
  );
}
