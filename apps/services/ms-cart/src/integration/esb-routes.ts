/**
 * Rutas del ESB hacia Cart (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en
 * el cuerpo.
 */
export interface CartRestRoute {
  protocol: 'rest';
  target: 'cart';
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const CART_BASE_PATH = '/api/v3';

const route = (method: CartRestRoute['method'], path: string, timeoutMs = 3000): CartRestRoute => ({
  protocol: 'rest', target: 'cart', method, path: `${CART_BASE_PATH}${path}`, timeoutMs,
});

export const MS_CART_ROUTES = {
  'cart.health': route('GET', '/health', 1000),
  'cart.getCart': route('GET', '/carrito'),
  'cart.clearCart': route('DELETE', '/carrito'),
  // Agregar y editar consultan a Catalog e Inventory.
  'cart.addItem': route('POST', '/carrito/items', 6000),
  'cart.updateItem': route('PATCH', '/carrito/items/:itemId', 6000),
  'cart.removeItem': route('DELETE', '/carrito/items/:itemId'),

  // Uso interno (`X-Service-Token`): Order.
  'cart.getItem': route('GET', '/internal/carrito-items/:itemId'),
  'cart.linkItem': route('POST', '/internal/carrito-items/:itemId/orden'),
  'cart.confirmItem': route('POST', '/internal/carrito-items/:itemId/orden/confirmacion'),
  'cart.releaseItem': route('POST', '/internal/carrito-items/:itemId/orden/liberacion'),
} as const satisfies Record<string, CartRestRoute>;

export type CartRouteKey = keyof typeof MS_CART_ROUTES;

/** Nombre de la operación para `EsbClient.call('cart', operación)` (`cart.getCart` → `getCart`). */
export type CartOperation = CartRouteKey extends `cart.${infer O}` ? O : never;
