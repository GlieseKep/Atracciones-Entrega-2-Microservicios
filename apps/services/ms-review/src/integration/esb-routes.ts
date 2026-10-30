/**
 * Rutas del ESB hacia Review (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB las registra tal cual en el corte.
 *
 * El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en el cuerpo.
 */
export interface ReviewRestRoute {
  protocol: 'rest';
  target: 'review';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const REVIEW_BASE_PATH = '/api/v3';

const route = (method: ReviewRestRoute['method'], path: string, timeoutMs = 3000): ReviewRestRoute => ({
  protocol: 'rest', target: 'review', method, path: `${REVIEW_BASE_PATH}${path}`, timeoutMs,
});

export const MS_REVIEW_ROUTES = {
  'review.health': route('GET', '/health', 1000),

  // Portal (GraphQL): lectura pública, publicar y mis reseñas.
  'review.listByAttraction': route('GET', '/atracciones/:attraction_id/resenas'),
  'review.getSummary': route('GET', '/atracciones/:attraction_id/calificacion', 2000),
  // Publicar consulta a Booking por el ESB: plazo mayor.
  'review.create': route('POST', '/atracciones/:attraction_id/resenas', 6000),
  'review.listMine': route('GET', '/usuarios/me/resenas'),

  // Moderación (rol ADMIN).
  'review.listForModeration': route('GET', '/resenas'),
  'review.setVisibility': route('PUT', '/resenas/:id/visibilidad'),
} as const satisfies Record<string, ReviewRestRoute>;

export type ReviewRouteKey = keyof typeof MS_REVIEW_ROUTES;

/** Nombre de la operación para `EsbClient.call('review', operación)` (`review.create` → `create`). */
export type ReviewOperation = ReviewRouteKey extends `review.${infer O}` ? O : never;
