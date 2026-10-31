/**
 * Rutas del ESB hacia Refund (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET) o en el cuerpo.
 */
export interface RefundRestRoute {
  protocol: 'rest';
  target: 'refund';
  method: 'GET' | 'POST';
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
  // Consulta el monto cobrado en Payment.
  'refund.createRefund': route('POST', '/reembolsos', 6000),
  'refund.listRefunds': route('GET', '/reembolsos'),
  'refund.getRefund': route('GET', '/reembolsos/:numero'),
} as const satisfies Record<string, RefundRestRoute>;

export type RefundRouteKey = keyof typeof MS_REFUND_ROUTES;

/** Nombre de la operación para `EsbClient.call('refund', operación)` (`refund.getRefund` → `getRefund`). */
export type RefundOperation = RefundRouteKey extends `refund.${infer O}` ? O : never;
