/**
 * Rutas del ESB hacia Support (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB las registra tal cual en el corte (reemplazan a `audit.*ContactMessage*`).
 *
 * El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en el cuerpo.
 */
export interface SupportRestRoute {
  protocol: 'rest';
  target: 'support';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const SUPPORT_BASE_PATH = '/api/v3';

const route = (method: SupportRestRoute['method'], path: string, timeoutMs = 3000): SupportRestRoute => ({
  protocol: 'rest', target: 'support', method, path: `${SUPPORT_BASE_PATH}${path}`, timeoutMs,
});

export const MS_SUPPORT_ROUTES = {
  'support.health': route('GET', '/health', 1000),

  // Formulario del portal (GraphQL, con o sin sesión).
  'support.sendContactMessage': route('POST', '/mensajes-contacto'),

  // Bandeja de soporte (GraphQL, rol ADMIN).
  'support.listContactMessages': route('GET', '/mensajes-contacto'),
  'support.contactSummary': route('GET', '/mensajes-contacto/resumen'),
  'support.setContactMessageStatus': route('PUT', '/mensajes-contacto/:id/estado'),
} as const satisfies Record<string, SupportRestRoute>;

export type SupportRouteKey = keyof typeof MS_SUPPORT_ROUTES;

/** Nombre de la operación para `EsbClient.call('support', operación)` (`support.contactSummary` → `contactSummary`). */
export type SupportOperation = SupportRouteKey extends `support.${infer O}` ? O : never;
