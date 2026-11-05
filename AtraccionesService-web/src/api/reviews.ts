import type { Review, ReviewInput, ReviewPage } from '@/types/review';
import { gql } from './client';

/** Reseñas visibles de una atracción (ms-review). `id` es el código público de la atracción. */
export const listReviews = (id: string, params: { page?: number; limit?: number } = {}, signal?: AbortSignal) =>
  gql.query<ReviewPage>('reviewListReviews', { id, ...params }, { signal });

export const createReview = (id: string, body: ReviewInput) => gql.mutation<Review>('reviewCreateReview', { id, ...body });
