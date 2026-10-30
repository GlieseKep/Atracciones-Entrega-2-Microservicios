import type { EsbClient } from '@atracciones/platform';
import type { CartDto, CartItemDto, CartItemInput, CartItemPatch } from '../contract';
import type { CartOperation } from './esb-routes';

/**
 * Cliente de Cart a través del ESB (operaciones de `MS_CART_ROUTES`).
 *
 * - Order: `getItem`, `linkItem`, `confirmItem` y `releaseItem`.
 * - GraphQL: carrito del portal.
 */
export class CartClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'cart',
  ) {}

  private call<T>(operation: CartOperation, input: object = {}, idempotencyKey?: string): Promise<T> {
    return this.esb.call<T>(this.service, operation, input, idempotencyKey ? { idempotencyKey } : {});
  }

  getCart(): Promise<CartDto> {
    return this.call('getCart');
  }

  clearCart(): Promise<CartDto> {
    return this.call('clearCart');
  }

  addItem(input: Partial<CartItemInput> & { attraction_id: string }): Promise<CartDto> {
    return this.call('addItem', input);
  }

  updateItem(itemId: number, patch: CartItemPatch): Promise<CartDto> {
    return this.call('updateItem', { itemId, ...patch });
  }

  removeItem(itemId: number): Promise<CartDto> {
    return this.call('removeItem', { itemId });
  }

  getItem(itemId: number, usuId: number): Promise<CartItemDto> {
    return this.call('getItem', { itemId, usu_id: usuId });
  }

  linkItem(itemId: number, orderNumber: string, idempotencyKey: string): Promise<CartItemDto> {
    return this.call('linkItem', { itemId, external_order_id: orderNumber }, idempotencyKey);
  }

  confirmItem(itemId: number, orderNumber: string): Promise<CartItemDto> {
    return this.call('confirmItem', { itemId, external_order_id: orderNumber });
  }

  releaseItem(itemId: number, orderNumber: string): Promise<CartItemDto> {
    return this.call('releaseItem', { itemId, external_order_id: orderNumber });
  }
}
