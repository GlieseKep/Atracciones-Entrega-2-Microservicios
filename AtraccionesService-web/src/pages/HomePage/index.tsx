import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CalendarCheck, LogIn, MapPinned, Quote, ShieldCheck, UserPlus } from 'lucide-react';
import { listReviews } from '@/api/reviews';
import { AttractionCard, AttractionCardSkeleton } from '@/components/attractions/AttractionCard';
import { Button, ButtonLink } from '@/components/common/Button';
import { ErrorState } from '@/components/common/Feedback';
import { Rating } from '@/components/common/Rating';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { PageHero } from '@/components/layout/PageHero';
import { SearchBar } from '@/components/search/SearchBar';
import { Carousel, CarouselItem } from '@/components/ui/Carousel';
import { DestinationChip } from '@/components/ui/DestinationChip';
import { Faq } from '@/components/ui/Faq';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { serializeFilters } from '@/features/attractions/filters';
import { FAQ } from '@/features/content/faq';
import { HERO_PHOTO } from '@/features/content/photos';
import { useAsync } from '@/hooks/useAsync';
import { useCategories, useCities, useSearch } from '@/hooks/useAttractions';
import { useAuth } from '@/hooks/useAuth';
import type { AttractionCard as Card } from '@/types/attraction';
import { paths } from '@/utils/routes';

const WHY_US = [
  { icon: CalendarCheck, title: 'Cupos en tiempo real', text: 'Consultamos la disponibilidad de cada horario antes de cobrar.' },
  { icon: MapPinned, title: 'Operadores locales', text: 'Experiencias de operadores y guías de cada región de Ecuador.' },
  { icon: ShieldCheck, title: 'Compra en un solo paso', text: 'Orden, cupos y pago se confirman juntos: si algo falla, no se cobra.' },
  { icon: BadgeCheck, title: 'Opiniones de viajeros', text: 'Las valoraciones vienen de personas con cuenta en el portal.' },
];

/** Destinos a partir del catálogo real: ciudades con experiencias, ordenadas por cantidad. */
function destinationsOf(cards: Card[], cityImages: Map<string, string>) {
  const byCity = new Map<string, { count: number; image?: string }>();
  for (const card of cards) {
    const entry = byCity.get(card.city) ?? { count: 0, image: cityImages.get(card.city) ?? card.photos?.[0] };
    entry.count++;
    byCity.set(card.city, entry);
  }
  return [...byCity.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 6);
}

/** Página de destino: todo lo que muestra sale de Catalog, Location y Review. */
export default function HomePage() {
  const popular = useSearch({ sort: 'POPULARITY', limit: 50 });
  const topRated = useSearch({ sort: 'RATING_DESC', limit: 8 });
  const categories = useCategories();
  const cities = useCities();
  const { isAuthenticated, signIn, signUp } = useAuth();

  const cards = useMemo(() => popular.data?.data ?? [], [popular.data]);
  const cityImages = useMemo(() => new Map((cities.data ?? []).filter((c) => c.imagen).map((c) => [c.nombre, c.imagen as string])), [cities.data]);
  const destinations = useMemo(() => destinationsOf(cards, cityImages), [cards, cityImages]);
  // Con más de 50 experiencias el conteo por ciudad de la primera página sería incompleto: no se muestra.
  const complete = (popular.data?.metadata.total_results ?? 0) <= cards.length;
  const rated = useMemo(() => (topRated.data?.data ?? []).filter((a) => a.rating.review_count > 0), [topRated.data]);

  return (
    <>
      <div className="page-container pt-4">
        <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Sudamérica' }, { label: 'Ecuador' }]} />
      </div>

      <PageHero
        image={HERO_PHOTO}
        imageAlt="Vista panorámica de Quito con la Basílica del Voto Nacional y los Andes al fondo"
        eyebrow="Ecuador"
        title="Cosas que hacer en Ecuador"
        subtitle="Volcanes, playas, bosques nublados y ciudades coloniales: compra experiencias con cupos garantizados."
      >
        <SearchBar variant="hero" />
      </PageHero>

      {(categories.data?.length ?? 0) > 0 && (
        <section aria-label="Explorar por categoría" className="page-container mt-6">
          <ul className="scrollbar-none flex gap-2 overflow-x-auto">
            {categories.data!.map((c) => (
              <li key={c.id} className="shrink-0">
                <Link
                  to={paths.attractions(serializeFilters({ category: c.id }))}
                  className="inline-flex rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-ink"
                >
                  {c.nombre}
                </Link>
              </li>
            ))}
            <li className="shrink-0">
              <Link
                to={paths.attractions(serializeFilters({ freeCancellation: true }))}
                className="inline-flex rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-ink"
              >
                Cancelación gratuita
              </Link>
            </li>
          </ul>
        </section>
      )}

      {destinations.length > 0 && (
        <section id="destinos" aria-labelledby="destinos-title" className="page-container mt-14 scroll-mt-32">
          <SectionHeader id="destinos-title" title="Destinos principales de Ecuador" action={{ label: 'Ver todos', to: paths.attractions() }} />
          <div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-6">
            {destinations.map(([city, { count, image }]) => (
              <DestinationChip
                key={city}
                name={city}
                image={image}
                to={paths.attractions(serializeFilters({ city }))}
                caption={complete ? `${count} ${count === 1 ? 'experiencia' : 'experiencias'}` : 'Ver experiencias'}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="top-title" className="page-container mt-14">
        <SectionHeader id="top-title" title="Las experiencias más populares" action={{ label: 'Ver todas las experiencias', to: paths.attractions() }} />
        {popular.status === 'error' ? (
          <ErrorState error={popular.error} onRetry={popular.retry} />
        ) : (
          <ul className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {popular.status === 'loading' && !popular.data
              ? Array.from({ length: 4 }, (_, i) => (
                  <li key={i}>
                    <AttractionCardSkeleton />
                  </li>
                ))
              : cards.slice(0, 8).map((a) => (
                  <li key={a.id} className="fade-in">
                    <AttractionCard attraction={a} />
                  </li>
                ))}
          </ul>
        )}
      </section>

      {rated.length > 0 && (
        <section id="experiencias" aria-labelledby="exp-title" className="page-container mt-16 scroll-mt-32">
          <SectionHeader
            id="exp-title"
            title="Mejor valoradas por los viajeros"
            action={{ label: 'Ver ranking', to: paths.attractions(serializeFilters({ sort: 'valoracion' })) }}
          />
          <Carousel label="Experiencias mejor valoradas">
            {rated.map((a) => (
              <CarouselItem key={a.id}>
                <AttractionCard attraction={a} />
              </CarouselItem>
            ))}
          </Carousel>
        </section>
      )}

      <section aria-labelledby="why-title" className="mt-16 bg-brand-50">
        <div className="page-container py-12">
          <h2 id="why-title" className="text-2xl sm:text-[28px]">
            Por qué comprar con nosotros
          </h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {WHY_US.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Icon size={32} className="text-brand-500" aria-hidden="true" />
                <h3 className="mt-3 text-base">{title}</h3>
                <p className="mt-1 text-sm text-ink-soft">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <LatestReviews attractions={rated.slice(0, 3)} />

      {!isAuthenticated && (
        <section aria-labelledby="login-title" className="page-container mt-16">
          <div className="flex flex-col items-start gap-5 rounded-lg bg-night px-6 py-10 text-white sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <div>
              <h2 id="login-title" className="text-2xl text-white">
                Compra en segundos con tu cuenta
              </h2>
              <p className="mt-2 max-w-xl text-white/80">Crea tu cuenta gratis para comprar, ver tus vouchers y gestionar tus reservas.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={() => signUp()}>
                <UserPlus size={18} aria-hidden="true" /> Crear cuenta
              </Button>
              <Button size="lg" variant="secondary" onClick={() => signIn()}>
                <LogIn size={18} aria-hidden="true" /> Iniciar sesión
              </Button>
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="faq-title" className="page-container mt-16">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 id="faq-title" className="text-2xl sm:text-[28px]">
              Preguntas frecuentes
            </h2>
            <p className="mt-2 text-ink-soft">Todo lo que necesitas saber antes de comprar.</p>
            <ButtonLink to={paths.help()} variant="secondary" className="mt-5">
              Centro de ayuda
            </ButtonLink>
          </div>
          <Faq items={FAQ} />
        </div>
      </section>
    </>
  );
}

/** La opinión más reciente de cada una de las experiencias mejor valoradas (ms-review). */
function LatestReviews({ attractions }: { attractions: Card[] }) {
  const ids = attractions.map((a) => a.id);
  const reviews = useAsync(
    (signal) =>
      Promise.all(
        attractions.map((a) =>
          listReviews(a.id, { limit: 1 }, signal)
            .then((page) => (page.data[0] ? { attraction: a, review: page.data[0] } : null))
            .catch(() => null),
        ),
      ),
    [ids.join(',')],
    ids.length > 0,
  );
  const items = (reviews.data ?? []).filter((x) => x !== null);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="reviews-title" className="page-container mt-16">
      <SectionHeader id="reviews-title" title="Lo que dicen los viajeros" />
      <ul className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {items.map(({ attraction, review }) => (
          <li key={review.id} className="card-surface flex flex-col p-5">
            <Rating score={review.puntuacion} showScore />
            <p className="mt-3 line-clamp-5 flex-1 text-sm text-ink-soft">
              <Quote size={14} className="mr-1 inline -translate-y-0.5 text-brand-400" aria-hidden="true" />
              {review.comentario}
            </p>
            <p className="mt-4 text-sm">
              <span className="font-semibold">{review.autor_nombre}</span> sobre{' '}
              <Link to={paths.attraction(attraction.id)} className="link">
                {attraction.name}
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
