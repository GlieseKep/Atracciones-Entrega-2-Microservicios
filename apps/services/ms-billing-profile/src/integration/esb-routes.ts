/**
 * Rutas del ESB hacia Billing Profile (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en
 * el cuerpo.
 */
export interface BillingRestRoute {
  protocol: 'rest';
  target: 'billing';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const BILLING_BASE_PATH = '/api/v3';

const route = (method: BillingRestRoute['method'], path: string, timeoutMs = 3000): BillingRestRoute => ({
  protocol: 'rest', target: 'billing', method, path: `${BILLING_BASE_PATH}${path}`, timeoutMs,
});

export const MS_BILLING_ROUTES = {
  'billing.health': route('GET', '/health', 1000),
  'billing.listProfiles': route('GET', '/usuarios/me/datos-facturacion'),
  'billing.createProfile': route('POST', '/usuarios/me/datos-facturacion'),
  'billing.replaceProfile': route('PUT', '/usuarios/me/datos-facturacion/:id'),
  'billing.deleteProfile': route('DELETE', '/usuarios/me/datos-facturacion/:id'),
  'billing.markPrincipal': route('PUT', '/usuarios/me/datos-facturacion/:id/principal'),

  // Uso interno (`X-Service-Token`): Invoicing.
  'billing.getPrincipal': route('GET', '/internal/usuarios/:usuId/datos-facturacion/principal'),
} as const satisfies Record<string, BillingRestRoute>;

export type BillingRouteKey = keyof typeof MS_BILLING_ROUTES;

/** Nombre de la operación para `EsbClient.call('billing', operación)` (`billing.getPrincipal` → `getPrincipal`). */
export type BillingOperation = BillingRouteKey extends `billing.${infer O}` ? O : never;
