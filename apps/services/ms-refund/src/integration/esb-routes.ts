/**
 * Rutas del ESB hacia Refund (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB las registra tal cual en el corte.
 *
 * El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en el cuerpo.
 */
export interface RefundRestRoute {
  protocol: 'rest';
  target: 'refund';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const REFUND_BASE_PATH = '/api/v3';

const route = (method: RefundRestRoute['method'], path: string, timeoutMs = 3000): RefundRestRoute => ({
  protocol: 'rest', target: 'refund', method, path: `${REFUND_BASE_PATH}${path}`, timeoutMs,
});

export const MS_REFUND_ROUTES = {
  'refund.health': route('GET', '/health', 1000),

  // Saga de cancelación de Order: consulta a Payment y a la pasarela, plazo mayor (reemplaza a payment.refund).
  'refund.refund': route('POST', '/reembolsos', 8000),

  // Consultas: Order (pagos de una orden), GraphQL (panel) y el administrador.
  'refund.list': route('GET', '/reembolsos'),
  'refund.get': route('GET', '/reembolsos/:codigo'),
  'refund.listByOrder': route('GET', '/reembolsos/orden/:orden_id'),
  'refund.listByPayments': route('POST', '/reembolsos/pagos'),
} as const satisfies Record<string, RefundRestRoute>;

export type RefundRouteKey = keyof typeof MS_REFUND_ROUTES;

/** Nombre de la operación para `EsbClient.call('refund', operación)` (`refund.refund` → `refund`). */
export type RefundOperation = RefundRouteKey extends `refund.${infer O}` ? O : never;
