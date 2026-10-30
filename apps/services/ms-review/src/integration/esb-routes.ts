/**
 * Rutas del ESB hacia Review (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET) o en el cuerpo.
 */
export interface ReviewRestRoute {
  protocol: 'rest';
  target: 'review';
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const REVIEW_BASE_PATH = '/api/v3';

const route = (method: ReviewRestRoute['method'], path: string, timeoutMs = 4000): ReviewRestRoute => ({
  protocol: 'rest', target: 'review', method, path: `${REVIEW_BASE_PATH}${path}`, timeoutMs,
});

export const MS_REVIEW_ROUTES = {
  'review.health': route('GET', '/health', 1000),
  'review.listReviews': route('GET', '/atracciones/:id/resenas'),
  'review.createReview': route('POST', '/atracciones/:id/resenas'),
  'review.createAnonymousReview': route('POST', '/atracciones/:id/resenas/anonimas'),
  'review.listMyReviews': route('GET', '/usuarios/me/resenas'),
  'review.updateMyReview': route('PUT', '/usuarios/me/resenas/:id'),

  // Moderación (rol ADMIN).
  'review.adminListReviews': route('GET', '/admin/resenas'),
  'review.setReviewVisible': route('PUT', '/admin/resenas/:id/visibilidad'),
} as const satisfies Record<string, ReviewRestRoute>;

export type ReviewRouteKey = keyof typeof MS_REVIEW_ROUTES;

/** Nombre de la operación para `EsbClient.call('review', operación)` (`review.listReviews` → `listReviews`). */
export type ReviewOperation = ReviewRouteKey extends `review.${infer O}` ? O : never;
