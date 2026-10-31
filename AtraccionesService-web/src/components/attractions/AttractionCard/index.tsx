import { Link } from 'react-router-dom';
import { Check, Clock, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { Badge, badgeTone } from '@/components/common/Badge';
import { Rating } from '@/components/common/Rating';
import type { Attraction } from '@/types/attraction';
import { formatDuration, formatPrice } from '@/utils/formatters';
import { paths } from '@/utils/routes';

/** Variante más ligera de una foto de Wikimedia (las de otros orígenes se usan tal cual). */
export const photoAt = (url: string, width: 330 | 500 | 960 | 1280) =>
  url.replace(/\/1280px-/, `/${width}px-`);

interface Props {
  attraction: Attraction;
  /** `grid`: tarjeta vertical (carruseles y rejilla). `list`: fila horizontal (resultados de búsqueda en desktop). */
  layout?: 'grid' | 'list';
}

export function AttractionCard({ attraction: a, layout = 'grid' }: Props) {
  const photo = a.photos[0]?.url;
  const city = a.locations[0]?.city;
  const isList = layout === 'list';

  return (
    <article
      className={`group relative flex overflow-hidden rounded-md bg-white transition duration-200 hover:-translate-y-0.5 ${
        isList ? 'flex-col border border-line hover:shadow-raised sm:flex-row' : 'flex-col'
      }`}
    >
      <div
        className={`relative shrink-0 overflow-hidden ${isList ? 'aspect-[4/3] sm:aspect-auto sm:w-[280px]' : 'aspect-[4/3] rounded-md'}`}
      >
        <CardImage src={photo} alt={a.name} />
        {a.badges[0] && (
          <Badge tone={badgeTone(a.badges[0])} className="absolute left-3 top-3">
            {a.badges[0]}
          </Badge>
        )}
      </div>

      <div className={`flex flex-1 flex-col ${isList ? 'p-4 sm:p-5' : 'pt-3'}`}>
        {city && <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{city}</p>}
        {a.ratings && <Rating score={a.ratings.score} reviews={a.ratings.numberOfReviews} className="mt-1" />}
        <h3 className={`mt-1 font-bold leading-snug ${isList ? 'text-lg' : 'line-clamp-2 text-base'}`}>
          <Link to={paths.attraction(a.id)} className="after:absolute after:inset-0 hover:underline">
            {a.name}
          </Link>
        </h3>
        {isList && <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{a.longDescription}</p>}
        <ul className="mt-2 space-y-1 text-sm text-ink-soft">
          <li className="flex items-center gap-1.5">
            <Clock size={15} aria-hidden="true" /> {formatDuration(a.duration)}
          </li>
          {a.freeCancellation && (
            <li className="flex items-center gap-1.5 font-semibold text-success">
              <Check size={15} aria-hidden="true" /> Cancelación gratuita
            </li>
          )}
        </ul>
        <p className={`mt-auto pt-3 ${isList ? 'sm:text-right' : ''}`}>
          <span className="text-sm text-ink-soft">desde </span>
          <span className="text-lg font-extrabold">{formatPrice(a.price)}</span>
        </p>
      </div>
    </article>
  );
}

function CardImage({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full min-h-[180px] w-full items-center justify-center bg-gradient-to-br from-brand-100 to-brand-300/60 text-brand-700">
        <ImageOff size={28} aria-hidden="true" />
        <span className="sr-only">{alt}</span>
      </div>
    );
  }
  return (
    <img
      src={photoAt(src, 500)}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
    />
  );
}

export function AttractionCardSkeleton({ layout = 'grid' }: { layout?: 'grid' | 'list' }) {
  return (
    <div
      aria-hidden="true"
      className={layout === 'list' ? 'flex gap-4 rounded-md border border-line p-3' : ''}
    >
      <div
        className={`skeleton ${layout === 'list' ? 'h-40 w-48 shrink-0' : 'aspect-[4/3] w-full rounded-md'}`}
      />
      <div className="mt-3 flex-1 space-y-2">
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-5 w-1/4" />
      </div>
    </div>
  );
}
