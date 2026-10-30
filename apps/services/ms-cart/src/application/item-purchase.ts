import { AppError } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { CartItemDto } from '../contract';
import { toItemDto, type CartRepository, type ItemRow } from '../persistence/cart-repository';

const alreadyOrdered = () => AppError.conflict('CART_ITEM_ALREADY_ORDERED', 'El ítem ya está ligado a otra orden.');
const notInPayment = () => AppError.conflict('CART_ITEM_NOT_IN_PAYMENT', 'El ítem no está en pago con esa orden.');

/** Transiciones `PENDIENTE` → `EN_PAGO` → `COMPRADO`. Todas son idempotentes: Order las reintenta. */
export class ItemPurchase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cart: CartRepository,
  ) {}

  private transition(id: number, step: (row: ItemRow, m: EntityManager) => Promise<ItemRow> | ItemRow): Promise<CartItemDto> {
    return this.dataSource.transaction(async (m) => toItemDto(await step(await this.cart.lockItem(id, m), m)));
  }

  /** `PENDIENTE` → `EN_PAGO`. Exige turno: sin él, `422 SLOT_REQUIRED`. */
  link(id: number, ordNumero: string, clave: string): Promise<CartItemDto> {
    return this.transition(id, (row, m) => {
      if (row.cai_estado === 'PENDIENTE') {
        if (!row.dis_slot_codigo) throw AppError.unprocessable('SLOT_REQUIRED', 'El ítem necesita un turno para pagarse.');
        return this.cart.setInPayment(id, ordNumero, clave, m);
      }
      if (row.cai_ord_numero === ordNumero && row.cai_orden_clave === clave) return row;
      throw alreadyOrdered();
    });
  }

  /** `EN_PAGO` → `COMPRADO`, tras el pago aprobado. */
  confirm(id: number, ordNumero: string): Promise<CartItemDto> {
    return this.transition(id, (row, m) => {
      if (row.cai_ord_numero !== ordNumero) throw notInPayment();
      return row.cai_estado === 'COMPRADO' ? row : this.cart.setBought(id, m);
    });
  }

  /** `EN_PAGO` → `PENDIENTE`, con el pago rechazado o la orden cancelada. */
  release(id: number, ordNumero: string): Promise<CartItemDto> {
    return this.transition(id, (row, m) => {
      if (row.cai_estado === 'PENDIENTE') return row;
      if (row.cai_estado === 'COMPRADO') throw alreadyOrdered();
      if (row.cai_ord_numero !== ordNumero) throw notInPayment();
      return this.cart.setPending(id, m);
    });
  }
}
