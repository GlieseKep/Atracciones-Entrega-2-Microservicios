import type { EsbClient } from '@atracciones/platform';
import type { CartDto, CartHealthDto, CartItemDto, CartItemRequestDto, CartItemUpdateDto } from '../contract';
import type { CartOperation } from './esb-routes';

/**
 * Cliente de Cart a través del ESB (operaciones de `MS_CART_ROUTES`). Los errores llegan como `AppError` con el estado y
 * el código del servicio (p. ej. 409 `CART_ITEM_IN_PAYMENT`).
 *
 * - Las operaciones del carrito usan el principal de la petición en curso: GraphQL las llama dentro del contexto del
 *   usuario y el ESB lo reenvía.
 * - Las de compra exigen la cuenta de servicio de Order: llamarlas dentro de
 *   `asService('order', INTERNAL_TOKEN_SECRET, () => …)`.
 */
export class CartClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'cart',
  ) {}

  private call<T>(operation: CartOperation, input: object = {}, options: { idempotencyKey?: string } = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input, options);
  }

  health(): Promise<CartHealthDto> {
    return this.call('health');
  }

  // Carrito del usuario ------------------------------------------------------

  getCart(): Promise<CartDto> {
    return this.call('getCart');
  }

  /** Agrega una atracción (y opcionalmente un turno); si el par ya está pendiente, reemplaza las cantidades. */
  addItem(item: CartItemRequestDto): Promise<CartDto> {
    return this.call('addItem', item);
  }

  updateItem(itemId: number, changes: CartItemUpdateDto): Promise<CartDto> {
    return this.call('updateItem', { ...changes, item_id: itemId });
  }

  removeItem(itemId: number): Promise<CartDto> {
    return this.call('removeItem', { item_id: itemId });
  }

  /** Quita los ítems pendientes; los que están en pago se conservan. */
  clear(): Promise<CartDto> {
    return this.call('clear');
  }

  // Compra de un ítem (Order) -------------------------------------------------

  getItem(cartId: number, itemId: number): Promise<CartItemDto> {
    return this.call('getItem', { cart_id: cartId, item_id: itemId });
  }

  /** PENDIENTE → EN_PAGO. `idempotencyKey` es la misma de la compra: repetirla con la misma orden no cambia nada. */
  startItemPayment(cartId: number, itemId: number, externalOrderId: string, idempotencyKey: string): Promise<CartItemDto> {
    return this.call('startItemPayment', { cart_id: cartId, item_id: itemId, external_order_id: externalOrderId }, { idempotencyKey });
  }

  /** EN_PAGO → COMPRADO. Solo después de validar que el pago de esa orden fue aprobado. */
  confirmItemPurchase(cartId: number, itemId: number, externalOrderId: string): Promise<CartItemDto> {
    return this.call('confirmItemPurchase', { cart_id: cartId, item_id: itemId, external_order_id: externalOrderId });
  }

  /** EN_PAGO → PENDIENTE, cuando el pago se rechaza o falla. */
  releaseItemPayment(cartId: number, itemId: number, externalOrderId: string): Promise<CartItemDto> {
    return this.call('releaseItemPayment', { cart_id: cartId, item_id: itemId, external_order_id: externalOrderId });
  }
}
