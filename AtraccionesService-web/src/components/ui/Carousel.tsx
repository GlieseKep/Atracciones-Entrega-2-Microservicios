import { useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Fila horizontal desplazable con flechas en desktop (carruseles de Viator). */
export function Carousel({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  const arrow =
    'absolute top-[30%] z-10 hidden h-10 w-10 items-center justify-center rounded-full border border-line bg-white shadow-card hover:shadow-raised md:flex';
  return (
    <div className="relative" role="region" aria-label={label}>
      <button type="button" className={`${arrow} -left-5`} onClick={() => scroll(-1)} aria-label="Anterior">
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <div ref={ref} className="scrollbar-none -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {children}
      </div>
      <button type="button" className={`${arrow} -right-5`} onClick={() => scroll(1)} aria-label="Siguiente">
        <ChevronRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

export function CarouselItem({ children }: { children: ReactNode }) {
  return <div className="w-[260px] shrink-0 snap-start sm:w-[280px]">{children}</div>;
}
