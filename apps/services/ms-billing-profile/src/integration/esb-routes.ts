/**
 * Rutas del ESB hacia Billing Profile (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute`
 * de `apps/esb/src/routes.ts`. El ESB las registra tal cual en el corte.
 *
 * El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en el cuerpo.
 */
export interface BillingProfileRestRoute {
  protocol: 'rest';
  target: 'billing';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const BILLING_PROFILE_BASE_PATH = '/api/v3';

const route = (method: BillingProfileRestRoute['method'], path: string, timeoutMs = 3000): BillingProfileRestRoute => ({
  protocol: 'rest', target: 'billing', method, path: `${BILLING_PROFILE_BASE_PATH}${path}`, timeoutMs,
});

export const MS_BILLING_PROFILE_ROUTES = {
  'billing.health': route('GET', '/health', 1000),

  // Mis datos de facturación (GraphQL, con el JWT del usuario).
  'billing.listMine': route('GET', '/usuarios/me/datos-facturacion'),
  'billing.create': route('POST', '/usuarios/me/datos-facturacion'),
  'billing.replace': route('PUT', '/usuarios/me/datos-facturacion/:id'),
  'billing.deactivate': route('DELETE', '/usuarios/me/datos-facturacion/:id'),
  'billing.setPrincipal': route('PUT', '/usuarios/me/datos-facturacion/:id/principal'),

  // Compatibilidad: reemplazan a identity.getBilling / identity.saveBilling.
  'billing.getLegacy': route('GET', '/usuarios/me/facturacion'),
  'billing.saveLegacy': route('PUT', '/usuarios/me/facturacion'),

  // Uso interno (Order, Invoicing).
  'billing.getProfile': route('GET', '/datos-facturacion/:id', 2000),
} as const satisfies Record<string, BillingProfileRestRoute>;

export type BillingProfileRouteKey = keyof typeof MS_BILLING_PROFILE_ROUTES;

/** Nombre de la operación para `EsbClient.call('billing', operación)` (`billing.getProfile` → `getProfile`). */
export type BillingProfileOperation = BillingProfileRouteKey extends `billing.${infer O}` ? O : never;
