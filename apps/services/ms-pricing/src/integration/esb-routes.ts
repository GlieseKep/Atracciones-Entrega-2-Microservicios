/** Rutas del ESB hacia Pricing (`servicio.operación` → `POST /internal/rpc/<Método>`), con la misma forma que `RestRoute` de `apps/esb/src/routes.ts`. */
export interface PricingRestRoute {
  protocol: 'rest';
  target: 'pricing';
  method: 'POST';
  path: string;
  timeoutMs: number;
}

const route = (method: string, timeoutMs = 2000): PricingRestRoute => ({
  protocol: 'rest', target: 'pricing', method: 'POST', path: `/internal/rpc/${method}`, timeoutMs,
});

export const MS_PRICING_ROUTES = {
  'pricing.health': route('Health', 1000),
  'pricing.quoteTickets': route('QuoteTickets'),
  'pricing.getPriceTable': route('GetPriceTable'),
  'pricing.listTariffs': route('ListTariffs', 5000),
  'pricing.setPriceTable': route('SetPriceTable', 5000),
} as const satisfies Record<string, PricingRestRoute>;

export type PricingRouteKey = keyof typeof MS_PRICING_ROUTES;

/** Nombre de la operación para `EsbClient.call('pricing', operación)` (`pricing.quoteTickets` → `quoteTickets`). */
export type PricingOperation = PricingRouteKey extends `pricing.${infer O}` ? O : never;
