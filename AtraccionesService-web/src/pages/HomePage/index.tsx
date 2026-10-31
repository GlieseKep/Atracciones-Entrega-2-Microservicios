import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CalendarCheck, LogIn, MapPinned, Quote, ShieldCheck, UserPlus } from 'lucide-react';
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
import { StoryCard } from '@/components/ui/StoryCard';
import { photoAt } from '@/components/attractions/AttractionCard';
import { HERO_PHOTO } from '@/features/attractions/demoCatalog';
import { serializeFilters, sortAttractions } from '@/features/attractions/filters';
import { AUDIENCES, DESTINATIONS, FAQ, QUICK_CATEGORIES, STORIES, TESTIMONIALS, WHY_US } from '@/features/content/homeContent';
import { useAllAttractions } from '@/hooks/useAttractions';
import { useAuth } from '@/hooks/useAuth';
import { paths } from '@/utils/routes';

const WHY_ICONS = [CalendarCheck, MapPinned, ShieldCheck, BadgeCheck];

/** Página de destino al estilo "Cosas que hacer en Quito" de Viator, ampliada a Ecuador. */
export default function HomePage() {
  const catalog = useAllAttractions();
  const { isAuthenticated, signIn, signUp } = useAuth();
  const [audience, setAudience] = useState(AUDIENCES[0].id);

  const all = useMemo(() => catalog.data ?? [], [catalog.data]);
  const top = useMemo(() => sortAttractions(all, 'destacados').slice(0, 8), [all]);
  const audienceItems = useMemo(() => {
    const ids = AUDIENCES.find((a) => a.id === audience)?.ids ?? [];
    const picked = all.filter((a) => ids.includes(a.id));
    return picked.length >= 2 ? picked : sortAttractions(all, 'valoracion').slice(0, 4);
  }, [all, audience]);

  const countIn = (city: string) => all.filter((a) => a.locations.some((l) => l.city === city)).length;

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
        subtitle="Volcanes, lagunas turquesa, bosques nublados y ciudades coloniales: reserva las experiencias más fotogénicas del país."
      >
        <SearchBar variant="hero" />
      </PageHero>

      {/* Filtros rápidos por categoría (chips de Viator) */}
      <section aria-label="Explorar por categoría" className="page-container mt-6">
        <ul className="scrollbar-none flex gap-2 overflow-x-auto">
          {QUICK_CATEGORIES.map((c) => (
            <li key={c.category} className="shrink-0">
              <Link
                to={paths.attractions(serializeFilters({ categories: [c.category] }))}
                className="inline-flex rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-ink"
              >
                {c.label}
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

      <section id="destinos" aria-labelledby="destinos-title" className="page-container mt-14 scroll-mt-32">
        <SectionHeader id="destinos-title" title="Destinos principales de Ecuador" action={{ label: 'Ver todos', to: paths.attractions() }} />
        <div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-6">
          {DESTINATIONS.map((d) => {
            const count = countIn(d.city);
            return (
              <DestinationChip
                key={d.name}
                name={d.name}
                image={d.image}
                to={paths.attractions(serializeFilters({ city: d.city }))}
                caption={count ? `${count} ${count === 1 ? 'experiencia' : 'experiencias'}` : d.caption}
              />
            );
          })}
        </div>
      </section>

      <section aria-labelledby="top-title" className="page-container mt-14">
        <SectionHeader id="top-title" title="Las mejores cosas que hacer en Ecuador" action={{ label: 'Ver todas las experiencias', to: paths.attractions() }} />
        {catalog.status === 'error' ? (
          <ErrorState error={catalog.error} onRetry={catalog.retry} onLogin={() => signIn()} />
        ) : (
          <ul className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {catalog.status === 'loading' && !catalog.data
              ? Array.from({ length: 4 }, (_, i) => (
                  <li key={i}>
                    <AttractionCardSkeleton />
                  </li>
                ))
              : top.map((a) => (
                  <li key={a.id} className="fade-in">
                    <AttractionCard attraction={a} />
                  </li>
                ))}
          </ul>
        )}
      </section>

      <section id="experiencias" aria-labelledby="exp-title" className="page-container mt-16 scroll-mt-32">
        <SectionHeader id="exp-title" title="Experiencias recomendadas" subtitle={AUDIENCES.find((a) => a.id === audience)?.description} />
        <div role="tablist" aria-label="Tipo de viajero" className="mb-6 flex gap-2 overflow-x-auto">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              role="tab"
              type="button"
              aria-selected={audience === a.id}
              onClick={() => setAudience(a.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                audience === a.id ? 'bg-ink text-white' : 'border border-line hover:border-ink'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <Carousel label="Experiencias recomendadas">
          {audienceItems.map((a) => (
            <CarouselItem key={a.id}>
              <AttractionCard attraction={a} />
            </CarouselItem>
          ))}
        </Carousel>
      </section>

      <section aria-labelledby="why-title" className="mt-16 bg-brand-50">
        <div className="page-container py-12">
          <h2 id="why-title" className="text-2xl sm:text-[28px]">
            Por qué viajar con nosotros
          </h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {WHY_US.map((item, i) => {
              const Icon = WHY_ICONS[i];
              return (
                <li key={item.title}>
                  <Icon size={32} className="text-brand-500" aria-hidden="true" />
                  <h3 className="mt-3 text-base">{item.title}</h3>
                  <p className="mt-1 text-sm text-ink-soft">{item.text}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section aria-labelledby="reviews-title" className="page-container mt-16">
        <SectionHeader id="reviews-title" title="Lo que dicen los viajeros" />
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <li key={t.name} className="card-surface flex flex-col overflow-hidden">
              <img src={photoAt(t.image, 500)} alt="" loading="lazy" className="h-40 w-full object-cover" />
              <div className="flex flex-1 flex-col p-5">
                <Rating score={t.rating} />
                <h3 className="mt-2 text-base">{t.title}</h3>
                <p className="mt-2 flex-1 text-sm text-ink-soft">
                  <Quote size={14} className="mr-1 inline -translate-y-0.5 text-brand-400" aria-hidden="true" />
                  {t.text}
                </p>
                <p className="mt-4 text-sm">
                  <span className="font-semibold">{t.name}</span> <span className="text-ink-muted">· {t.origin} · {t.date}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {!isAuthenticated && (
        <section aria-labelledby="login-title" className="page-container mt-16">
          <div className="flex flex-col items-start gap-5 rounded-lg bg-night px-6 py-10 text-white sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <div>
              <h2 id="login-title" className="text-2xl text-white">
                Reserva en segundos con tu cuenta
              </h2>
              <p className="mt-2 max-w-xl text-white/80">
                Crea tu cuenta gratis para reservar, pagar y seguir tus pedidos desde cualquier dispositivo.
              </p>
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

      <section id="historias" aria-labelledby="stories-title" className="page-container mt-16 scroll-mt-32">
        <SectionHeader id="stories-title" title="Ideas de viaje" subtitle="Inspiración y guías para tu próxima escapada por Ecuador." />
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {STORIES.map((s) => (
            <li key={s.title}>
              <StoryCard {...s} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="faq-title" className="page-container mt-16">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 id="faq-title" className="text-2xl sm:text-[28px]">
              Preguntas frecuentes
            </h2>
            <p className="mt-2 text-ink-soft">Todo lo que necesitas saber antes de reservar.</p>
            <ButtonLink to="/ayuda" variant="secondary" className="mt-5">
              Centro de ayuda
            </ButtonLink>
          </div>
          <Faq items={FAQ} />
        </div>
      </section>
    </>
  );
}
