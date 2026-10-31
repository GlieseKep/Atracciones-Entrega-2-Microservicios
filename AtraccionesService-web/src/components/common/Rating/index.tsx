import { Star } from 'lucide-react';
import { formatReviewCount, formatScore } from '@/utils/formatters';

interface RatingProps {
  score: number;
  reviews?: number;
  size?: number;
  showScore?: boolean;
  className?: string;
}

/** Estrellas + número de opiniones, como en las tarjetas de Viator: ★★★★½ (1.250) */
export function Rating({ score, reviews, size = 14, showScore = false, className = '' }: RatingProps) {
  const label = `Valoración ${formatScore(score)} de 5${reviews !== undefined ? `, ${formatReviewCount(reviews)} opiniones` : ''}`;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} role="img" aria-label={label}>
      {showScore && <span className="font-bold text-ink">{formatScore(score)}</span>}
      <span className="flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => {
          const fill = Math.max(0, Math.min(1, score - (i - 1)));
          return (
            <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
              <Star size={size} className="absolute inset-0 text-brand-100" fill="currentColor" strokeWidth={0} />
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star size={size} className="text-brand-500" fill="currentColor" strokeWidth={0} />
              </span>
            </span>
          );
        })}
      </span>
      {reviews !== undefined && <span className="text-sm text-ink-muted">({formatReviewCount(reviews)})</span>}
    </span>
  );
}
