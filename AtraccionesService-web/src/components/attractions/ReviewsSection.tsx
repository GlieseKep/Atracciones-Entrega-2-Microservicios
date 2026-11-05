import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MessageSquarePlus } from 'lucide-react';
import { createReview, listReviews } from '@/api/reviews';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { TextArea } from '@/components/common/Input';
import { Rating } from '@/components/common/Rating';
import { Select } from '@/components/common/Select';
import { Pagination } from '@/components/search/SearchResults';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
import type { AttractionDetail } from '@/types/attraction';
import { errorMessage } from '@/utils/api';
import { formatDateTime } from '@/utils/dates';
import { formatReviewCount, formatScore } from '@/utils/formatters';
import { reviewSchema, type ReviewValues } from '@/utils/validation';

const PAGE = 5;

const PILLARS = [
  { key: 'limpieza', label: 'Limpieza' },
  { key: 'servicio', label: 'Servicio' },
  { key: 'calidad_precio', label: 'Calidad-precio' },
  { key: 'puntualidad', label: 'Puntualidad' },
] as const;

/** Opiniones visibles de ms-review y el desglose de la ficha. Con sesión se puede dejar una reseña. */
export function ReviewsSection({ attraction: a }: { attraction: AttractionDetail }) {
  const [page, setPage] = useState(1);
  const [writing, setWriting] = useState(false);
  const reviews = useAsync((signal) => listReviews(a.id, { page, limit: PAGE }, signal), [a.id, page]);
  const { isAuthenticated, signIn } = useAuth();
  const { rating } = a;

  return (
    <section id="opiniones" className="scroll-mt-32 border-t border-line py-8" aria-labelledby="reviews-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="reviews-title" className="text-xl">
          Opiniones
        </h2>
        <Button variant="secondary" size="sm" onClick={() => (isAuthenticated ? setWriting((v) => !v) : signIn())}>
          <MessageSquarePlus size={16} aria-hidden="true" /> Escribir una opinión
        </Button>
      </div>

      {rating.review_count > 0 && (
        <div className="grid gap-5 rounded-md bg-brand-50 p-5 sm:grid-cols-[auto_1fr]">
          <div>
            <p className="text-5xl font-extrabold">{formatScore(rating.score)}</p>
            <Rating score={rating.score} size={18} />
            <p className="mt-1 text-sm text-ink-soft">
              {rating.badge_text ? `${rating.badge_text} · ` : ''}
              {formatReviewCount(rating.review_count)} opiniones
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            {PILLARS.map(({ key, label }) => (
              <li key={key} className="grid grid-cols-[110px_1fr_32px] items-center gap-2">
                <span>{label}</span>
                <span className="h-2 rounded-full bg-white">
                  <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(rating.breakdown[key] / 10) * 100}%` }} />
                </span>
                <span className="text-right font-semibold">{formatScore(rating.breakdown[key])}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {writing && (
        <ReviewForm
          attractionId={a.id}
          onDone={() => {
            setWriting(false);
            setPage(1);
            reviews.retry();
          }}
        />
      )}

      <div className="mt-6">
        {reviews.status === 'error' ? (
          <ErrorState error={reviews.error} onRetry={reviews.retry} className="py-8" />
        ) : !reviews.data ? (
          <div className="skeleton h-32" aria-busy="true" />
        ) : reviews.data.data.length === 0 ? (
          <p className="text-ink-soft">Todavía no hay opiniones. ¡Sé la primera persona en contar su experiencia!</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {reviews.data.data.map((r) => (
                <li key={r.id} className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Rating score={r.puntuacion} showScore />
                    <span className="text-xs text-ink-muted">{formatDateTime(r.creado_en)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-line">{r.comentario}</p>
                  <p className="mt-1 text-sm font-semibold text-ink-soft">{r.autor_nombre}</p>
                </li>
              ))}
            </ul>
            <Pagination page={page} totalPages={reviews.data.pagination.total_pages} onPage={setPage} />
          </>
        )}
      </div>
    </section>
  );
}

function ReviewForm({ attractionId, onDone }: { attractionId: string; onDone: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [error, setError] = useState<unknown>(null);
  const scores = Array.from({ length: 10 }, (_, i) => ({ value: String(10 - i), label: String(10 - i) }));
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { puntuacion: 10, limpieza: 10, servicio: 10, calidad_precio: 10, puntualidad: 10, comentario: '' },
  });

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await createReview(attractionId, values);
      notify('¡Gracias por tu opinión!', 'success');
      onDone();
    } catch (e) {
      setError(e);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="card-surface mt-5 space-y-4 p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Select label="General" options={scores} {...register('puntuacion')} />
        {PILLARS.map(({ key, label }) => (
          <Select key={key} label={label} options={scores} {...register(key)} />
        ))}
      </div>
      <TextArea label="Tu experiencia" maxLength={1000} error={errors.comentario?.message} {...register('comentario')} />
      {!!error && <Alert tone="error">{errorMessage(error)}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          Publicar opinión
        </Button>
      </div>
    </form>
  );
}
