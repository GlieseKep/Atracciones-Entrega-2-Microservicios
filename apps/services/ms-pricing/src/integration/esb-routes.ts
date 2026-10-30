/** Rutas del ESB hacia Pricing (`servicio.operación` → método gRPC), con la misma forma que `GrpcRoute` de `apps/esb/src/routes.ts`. */
export interface PricingGrpcRoute {
  protocol: 'grpc';
  target: 'pricing';
  proto: 'internal/pricing.proto';
  service: 'descubre.pricing.PricingService';
  method: string;
  timeoutMs: number;
}

const route = (method: string, timeoutMs = 2000): PricingGrpcRoute => ({
  protocol: 'grpc', target: 'pricing', proto: 'internal/pricing.proto', service: 'descubre.pricing.PricingService', method, timeoutMs,
});

export const MS_PRICING_ROUTES = {
  'pricing.health': route('Health', 1000),
  'pricing.quoteTickets': route('QuoteTickets'),
  'pricing.getPriceTable': route('GetPriceTable'),
  'pricing.listTariffs': route('ListTariffs', 5000),
  'pricing.setPriceTable': route('SetPriceTable', 5000),
} as const satisfies Record<string, PricingGrpcRoute>;

export type PricingRouteKey = keyof typeof MS_PRICING_ROUTES;

/** Nombre de la operación para `EsbClient.call('pricing', operación)` (`pricing.quoteTickets` → `quoteTickets`). */
export type PricingOperation = PricingRouteKey extends `pricing.${infer O}` ? O : never;
