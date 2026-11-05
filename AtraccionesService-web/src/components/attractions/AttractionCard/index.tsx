import { Link } from 'react-router-dom';
import { Check, Clock, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Rating } from '@/components/common/Rating';
import { photoAt } from '@/features/content/photos';
import type { AttractionCard as Card } from '@/types/attraction';
import { formatFromPrice } from '@/utils/formatters';
import { paths } from '@/utils/routes';

interface Props {
  attraction: Card;
  /** `grid`: tarjeta vertical (carruseles y rejilla). `list`: fila horizontal (resultados en desktop). */
  layout?: 'grid' | 'list';
}

/** Tarjeta de `AtraccionCardResponseV2`: enlaza al detalle con el código público de ms-catalog. */
export function AttractionCard({ attraction: a, layout = 'grid' }: Props) {
  const isList = layout === 'list';
  const badge = a.rating.review_count > 0 ? a.rating.badge_text : undefined;

  return (
    <article
      className={`group relative flex overflow-hidden rounded-md bg-white transition duration-200 hover:-translate-y-0.5 ${
        isList ? 'flex-col border border-line hover:shadow-raised sm:flex-row' : 'flex-col'
      }`}
    >
      <div className={`relative shrink-0 overflow-hidden ${isList ? 'aspect-[4/3] sm:aspect-auto sm:w-[280px]' : 'aspect-[4/3] rounded-md'}`}>
        <CardImage src={a.photos?.[0]} alt={a.name} />
        {badge && (
          <Badge tone="overlay" className="absolute left-3 top-3">
            {badge}
          </Badge>
        )}
      </div>

      <div className={`flex flex-1 flex-col ${isList ? 'p-4 sm:p-5' : 'pt-3'}`}>
        {a.city && <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{a.city}</p>}
        {a.rating.review_count > 0 && <Rating score={a.rating.score} reviews={a.rating.review_count} className="mt-1" />}
        <h3 className={`mt-1 font-bold leading-snug ${isList ? 'text-lg' : 'line-clamp-2 text-base'}`}>
          <Link to={paths.attraction(a.id)} className="after:absolute after:inset-0 hover:underline">
            {a.name}
          </Link>
        </h3>
        {isList && a.short_description && <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{a.short_description}</p>}
        <ul className="mt-2 space-y-1 text-sm text-ink-soft">
          {a.duration && (
            <li className="flex items-center gap-1.5">
              <Clock size={15} aria-hidden="true" /> {a.duration}
            </li>
          )}
          {a.free_cancellation && (
            <li className="flex items-center gap-1.5 font-semibold text-success">
              <Check size={15} aria-hidden="true" /> Cancelación gratuita
            </li>
          )}
        </ul>
        <p className={`mt-auto pt-3 ${isList ? 'sm:text-right' : ''}`}>
          <span className="text-sm text-ink-soft">desde </span>
          <span className="text-lg font-extrabold">{formatFromPrice(a.price)}</span>
          <span className="text-sm text-ink-soft"> por adulto</span>
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
    <div aria-hidden="true" className={layout === 'list' ? 'flex gap-4 rounded-md border border-line p-3' : ''}>
      <div className={`skeleton ${layout === 'list' ? 'h-40 w-48 shrink-0' : 'aspect-[4/3] w-full rounded-md'}`} />
      <div className="mt-3 flex-1 space-y-2">
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-5 w-1/4" />
      </div>
    </div>
  );
}
