import { useParams } from 'react-router-dom';
import { MapPin, Share2 } from 'lucide-react';
import { AttractionCard } from '@/components/attractions/AttractionCard';
import { AttractionDetails } from '@/components/attractions/AttractionDetails';
import { AttractionGallery } from '@/components/attractions/AttractionGallery';
import { BookingCard } from '@/components/attractions/BookingCard';
import { ReviewsSection } from '@/components/attractions/ReviewsSection';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { ErrorState } from '@/components/common/Feedback';
import { Rating } from '@/components/common/Rating';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Carousel, CarouselItem } from '@/components/ui/Carousel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { serializeFilters } from '@/features/attractions/filters';
import { useAttraction, useSearch } from '@/hooks/useAttractions';
import { useUiStore } from '@/stores/uiStore';
import { isApiError } from '@/utils/api';
import { formatFromPrice } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import NotFoundPage from '../NotFoundPage';

export default function AttractionDetailPage() {
  const { id } = useParams();
  const attraction = useAttraction(id);
  const notify = useUiStore((s) => s.notify);
  const a = attraction.data;
  // Relacionadas: otras experiencias de la misma ciudad.
  const related = useSearch({ ciudad: a?.city, sort: 'POPULARITY', limit: 9 }, !!a?.city);

  if (attraction.status === 'error') {
    if (isApiError(attraction.error, 'notFound')) return <NotFoundPage />;
    return (
      <div className="page-container pt-10">
        <ErrorState error={attraction.error} onRetry={attraction.retry} />
      </div>
    );
  }
  if (!a) return <DetailSkeleton />;

  const others = (related.data?.data ?? []).filter((x) => x.id !== a.id).slice(0, 8);

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: a.name, url: window.location.href });
      else {
        await navigator.clipboard.writeText(window.location.href);
        notify('Enlace copiado al portapapeles.', 'success');
      }
    } catch {
      /* el usuario canceló */
    }
  };

  return (
    <div className="fade-in">
      <div className="page-container pt-4">
        <Breadcrumbs
          items={[
            { label: 'Inicio', to: '/' },
            { label: 'Ecuador', to: paths.attractions() },
            { label: a.city, to: paths.attractions(serializeFilters({ city: a.city })) },
            { label: a.name },
          ]}
        />

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            {a.rating.badge_text && a.rating.review_count > 0 && (
              <Badge tone="brand" className="mb-2">
                {a.rating.badge_text}
              </Badge>
            )}
            <h1 className="text-2xl leading-tight sm:text-[32px]">{a.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {a.rating.review_count > 0 && (
                <a href="#opiniones" className="inline-flex items-center gap-1 hover:underline">
                  <Rating score={a.rating.score} reviews={a.rating.review_count} showScore />
                </a>
              )}
              <span className="inline-flex items-center gap-1 text-ink-soft">
                <MapPin size={15} aria-hidden="true" /> {a.city}, Ecuador
              </span>
            </div>
          </div>
          <Button variant="tertiary" size="sm" onClick={share}>
            <Share2 size={16} aria-hidden="true" /> Compartir
          </Button>
        </div>

        <div className="mt-5">
          <AttractionGallery photos={a.photos ?? []} name={a.name} />
        </div>

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px]">
          <div>
            <AttractionDetails attraction={a} />
            <ReviewsSection attraction={a} />
          </div>
          <div id="reservar" className="scroll-mt-32">
            <div className="lg:sticky lg:top-36">
              <BookingCard attraction={a} />
            </div>
          </div>
        </div>
      </div>

      {others.length > 0 && (
        <section aria-labelledby="related-title" className="page-container mt-10">
          <SectionHeader id="related-title" title={`Más cosas que hacer en ${a.city}`} action={{ label: 'Ver todas', to: paths.attractions(serializeFilters({ city: a.city })) }} />
          <Carousel label="Experiencias relacionadas">
            {others.map((r) => (
              <CarouselItem key={r.id}>
                <AttractionCard attraction={r} />
              </CarouselItem>
            ))}
          </Carousel>
        </section>
      )}

      {/* Barra inferior fija en móvil */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between border-t border-line bg-white px-4 py-3 lg:hidden">
        <p>
          <span className="block text-xs text-ink-soft">Desde</span>
          <span className="text-lg font-extrabold">{formatFromPrice(a.price)}</span>
        </p>
        <a href="#reservar" className="rounded-full bg-brand-500 px-5 py-3 font-semibold text-white">
          Ver disponibilidad
        </a>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="page-container pt-6" aria-busy="true">
      <span className="sr-only" role="status">
        Cargando experiencia…
      </span>
      <div className="skeleton h-4 w-64" />
      <div className="skeleton mt-4 h-9 w-3/4" />
      <div className="skeleton mt-3 h-4 w-40" />
      <div className="skeleton mt-6 h-[440px] w-full rounded-lg" />
    </div>
  );
}
