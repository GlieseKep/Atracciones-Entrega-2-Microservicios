/**
 * Rutas del ESB hacia Pricing (`servicio.operación` → RPC), con la misma forma que `GrpcRoute` de
 * `apps/esb/src/routes.ts`. El ESB las registra tal cual en el corte; la entrada JSON es el mensaje del RPC.
 */
export interface PricingGrpcRoute {
  protocol: 'grpc';
  target: 'pricing';
  proto: 'internal/pricing.proto';
  service: 'atracciones.pricing.PricingService';
  method: string;
  timeoutMs: number;
}

const route = (method: string, timeoutMs = 2000): PricingGrpcRoute => ({
  protocol: 'grpc', target: 'pricing', proto: 'internal/pricing.proto', service: 'atracciones.pricing.PricingService', method, timeoutMs,
});

export const MS_PRICING_ROUTES = {
  'pricing.health': route('Health', 1000),

  // Consultas (Catalog, Inventory, Order, Partner API, GraphQL).
  'pricing.getPriceTable': route('GetPriceTable'),
  'pricing.getPriceTables': route('GetPriceTables'),
  'pricing.quoteTickets': route('QuoteTickets'),

  // Administración (GraphQL, rol ADMIN).
  'pricing.listTariffs': route('ListTariffs'),
  'pricing.setPriceTable': route('SetPriceTable', 3000),
  'pricing.setTariff': route('SetTariff'),
  'pricing.closeTariff': route('CloseTariff'),
} as const satisfies Record<string, PricingGrpcRoute>;

export type PricingRouteKey = keyof typeof MS_PRICING_ROUTES;

/** Nombre de la operación para `EsbClient.call('pricing', operación)` (`pricing.quoteTickets` → `quoteTickets`). */
export type PricingOperation = PricingRouteKey extends `pricing.${infer O}` ? O : never;
