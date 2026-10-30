import { AppError } from '@atracciones/platform';

/** Estado de compra de un ítem: cada atracción se paga por separado y pasa a su propia orden. */
export type ItemStatus = 'PENDIENTE' | 'EN_PAGO' | 'COMPRADO';

export interface PurchaseState {
  status: ItemStatus;
  slot: string | null;
  orderNumber: string | null;
  orderKey: string | null;
}

/** `apply`: hacer la transición; `noop`: ya estaba hecha con la misma orden (reintento), se responde igual. */
export type Decision = 'apply' | 'noop';

const alreadyOrdered = () =>
  AppError.conflict('CART_ITEM_ALREADY_ORDERED', 'El ítem ya está ligado a otra orden o ya se compró.');

/** Solo un ítem pendiente se edita o se quita; uno en pago espera a que Order confirme o libere el cobro. */
export function assertEditable(state: PurchaseState): void {
  if (state.status === 'EN_PAGO') throw AppError.conflict('CART_ITEM_IN_PAYMENT', 'El ítem se está pagando y no se puede modificar.');
}

/** PENDIENTE → EN_PAGO. Repetir con la misma orden y la misma clave no cambia nada. */
export function decideStart(state: PurchaseState, orderNumber: string, orderKey: string): Decision {
  if (state.status === 'PENDIENTE') {
    if (!state.slot) {
      throw AppError.unprocessable('SLOT_REQUIRED', 'El ítem no tiene turno: elija fecha y hora antes de pagarlo.', [
        { name: 'slot_id', reason: 'Obligatorio para pagar el ítem.' },
      ]);
    }
    return 'apply';
  }
  if (state.orderNumber === orderNumber && state.orderKey === orderKey) return 'noop';
  throw alreadyOrdered();
}

/** EN_PAGO → COMPRADO, solo después de que Order validó el pago aprobado de esa orden. */
export function decideConfirm(state: PurchaseState, orderNumber: string): Decision {
  if (state.orderNumber === orderNumber && state.status === 'EN_PAGO') return 'apply';
  if (state.orderNumber === orderNumber && state.status === 'COMPRADO') return 'noop';
  throw AppError.conflict('CART_ITEM_NOT_IN_PAYMENT', `El ítem no está en pago con la orden ${orderNumber}.`);
}

/** EN_PAGO → PENDIENTE cuando el pago se rechaza o falla. Un ítem comprado ya no se libera. */
export function decideRelease(state: PurchaseState, orderNumber: string): Decision {
  if (state.status === 'PENDIENTE') return 'noop';
  if (state.status === 'EN_PAGO' && state.orderNumber === orderNumber) return 'apply';
  throw alreadyOrdered();
}
