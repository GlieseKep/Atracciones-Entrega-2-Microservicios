/**
 * Rutas del ESB hacia Invoicing (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. Las operaciones SOAP `sri.*` ya están registradas en el ESB.
 */
export interface InvoicingRestRoute {
  protocol: 'rest';
  target: 'invoicing';
  method: 'GET';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const INVOICING_BASE_PATH = '/api/v3';

const route = (path: string, timeoutMs = 3000): InvoicingRestRoute => ({
  protocol: 'rest', target: 'invoicing', method: 'GET', path: `${INVOICING_BASE_PATH}${path}`, timeoutMs,
});

export const MS_INVOICING_ROUTES = {
  'invoicing.health': route('/health', 1000),
  'invoicing.listInvoices': route('/facturas'),
  'invoicing.getInvoice': route('/facturas/:id'),
  'invoicing.getOrderInvoice': route('/facturas/orden/:ordId'),
} as const satisfies Record<string, InvoicingRestRoute>;

export type InvoicingRouteKey = keyof typeof MS_INVOICING_ROUTES;

/** Nombre de la operación para `EsbClient.call('invoicing', operación)` (`invoicing.getInvoice` → `getInvoice`). */
export type InvoicingOperation = InvoicingRouteKey extends `invoicing.${infer O}` ? O : never;
