import { useState } from 'react';
import { ChevronLeft, ChevronRight, Images } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import type { Photo } from '@/types/attraction';
import { photoAt } from '../AttractionCard';

/** Galería tipo Viator: una foto grande + mosaico lateral y visor a pantalla completa. */
export function AttractionGallery({ photos, name }: { photos: Photo[]; name: string }) {
  const [viewer, setViewer] = useState<number | null>(null);
  if (!photos.length) {
    return <div className="aspect-[16/7] rounded-lg bg-gradient-to-br from-brand-100 to-brand-300/60" aria-hidden="true" />;
  }
  const [main, ...rest] = photos;
  const side = rest.slice(0, 2);

  return (
    <>
      <div className={`grid grid-cols-1 gap-2 overflow-hidden rounded-lg md:h-[440px] ${side.length ? 'md:grid-cols-[2fr_1fr]' : ''}`}>
        <button type="button" onClick={() => setViewer(0)} className="relative block aspect-[4/3] overflow-hidden md:aspect-auto md:h-full">
          <img src={main.url} alt={`${name}, foto 1`} className="absolute inset-0 h-full w-full object-cover transition duration-500 hover:scale-[1.02]" />
        </button>
        {side.length > 0 && (
          <div className={`hidden min-h-0 gap-2 md:grid ${side.length > 1 ? 'grid-rows-2' : 'grid-rows-1'}`}>
            {side.map((photo, i) => (
              <button key={photo.url} type="button" onClick={() => setViewer(i + 1)} className="relative block min-h-0 overflow-hidden">
                <img
                  src={photoAt(photo.url, 960)}
                  alt={`${name}, foto ${i + 2}`}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 hover:scale-[1.03]"
                />
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setViewer(0)}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-line px-4 py-1.5 text-sm font-semibold hover:bg-surface"
      >
        <Images size={16} aria-hidden="true" /> Ver las {photos.length} fotos
      </button>

      <Modal open={viewer !== null} onClose={() => setViewer(null)} title={`Fotos de ${name}`} size="lg">
        {viewer !== null && (
          <div>
            <img src={photos[viewer].url} alt={`${name}, foto ${viewer + 1}`} className="max-h-[60vh] w-full rounded-md object-contain" />
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                aria-label="Foto anterior"
                onClick={() => setViewer((viewer - 1 + photos.length) % photos.length)}
                className="rounded-full border border-line p-2 hover:bg-surface"
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <span className="text-sm text-ink-soft" aria-live="polite">
                {viewer + 1} / {photos.length}
              </span>
              <button
                type="button"
                aria-label="Foto siguiente"
                onClick={() => setViewer((viewer + 1) % photos.length)}
                className="rounded-full border border-line p-2 hover:bg-surface"
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
