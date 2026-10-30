/**
 * Rutas del ESB hacia Cart (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB las registra tal cual en el corte; así la tabla vive junto al contrato que describe.
 *
 * El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en el cuerpo.
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

  // Carrito del usuario (GraphQL, con el principal del usuario).
  'cart.getCart': route('GET', '/carrito'),
  'cart.clear': route('DELETE', '/carrito'),
  // Agregar o cambiar el turno consulta a Catalog e Inventory: plazo mayor.
  'cart.addItem': route('POST', '/carrito/items', 5000),
  'cart.updateItem': route('PATCH', '/carrito/items/:item_id', 5000),
  'cart.removeItem': route('DELETE', '/carrito/items/:item_id'),

  // Compra de un ítem (Order, con su cuenta de servicio): cada atracción se paga por separado.
  'cart.getItem': route('GET', '/carritos/:cart_id/items/:item_id'),
  'cart.startItemPayment': route('POST', '/carritos/:cart_id/items/:item_id/orden'),
  'cart.confirmItemPurchase': route('POST', '/carritos/:cart_id/items/:item_id/orden/confirmacion'),
  'cart.releaseItemPayment': route('POST', '/carritos/:cart_id/items/:item_id/orden/liberacion'),
} as const satisfies Record<string, CartRestRoute>;

export type CartRouteKey = keyof typeof MS_CART_ROUTES;

/** Nombre de la operación para `EsbClient.call('cart', operación)` (`cart.getCart` → `getCart`). */
export type CartOperation = CartRouteKey extends `cart.${infer O}` ? O : never;
