import { AppError } from '@atracciones/platform';
import { assertEditable, decideConfirm, decideRelease, decideStart, type PurchaseState } from './item-purchase';

const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const pending: PurchaseState = { status: 'PENDIENTE', slot: 'slot-20261025-1030', orderNumber: null, orderKey: null };
const paying: PurchaseState = { status: 'EN_PAGO', slot: 'slot-20261025-1030', orderNumber: 'ORD-1', orderKey: KEY };
const bought: PurchaseState = { ...paying, status: 'COMPRADO' };

const codeOf = (work: () => unknown) => {
  try {
    work();
    return null;
  } catch (error) {
    return error instanceof AppError ? `${error.status} ${error.code}` : String(error);
  }
};

describe('PENDIENTE → EN_PAGO', () => {
  it('un ítem pendiente con turno se liga a la orden', () => expect(decideStart(pending, 'ORD-1', KEY)).toBe('apply'));
  it('sin turno no se paga', () => expect(codeOf(() => decideStart({ ...pending, slot: null }, 'ORD-1', KEY))).toBe('422 SLOT_REQUIRED'));
  it('reintento con la misma orden y clave no cambia nada', () => expect(decideStart(paying, 'ORD-1', KEY)).toBe('noop'));
  it('otra orden no puede tomar el ítem', () => expect(codeOf(() => decideStart(paying, 'ORD-2', KEY))).toBe('409 CART_ITEM_ALREADY_ORDERED'));
  it('la misma orden con otra clave tampoco', () => expect(codeOf(() => decideStart(paying, 'ORD-1', 'otra'))).toBe('409 CART_ITEM_ALREADY_ORDERED'));
  it('un ítem comprado no se vuelve a pagar', () => expect(codeOf(() => decideStart(bought, 'ORD-9', KEY))).toBe('409 CART_ITEM_ALREADY_ORDERED'));
});

describe('EN_PAGO → COMPRADO (pago aprobado)', () => {
  it('confirma con la orden del ítem', () => expect(decideConfirm(paying, 'ORD-1')).toBe('apply'));
  it('confirmar dos veces responde igual', () => expect(decideConfirm(bought, 'ORD-1')).toBe('noop'));
  it('otra orden no confirma', () => expect(codeOf(() => decideConfirm(paying, 'ORD-2'))).toBe('409 CART_ITEM_NOT_IN_PAYMENT'));
  it('un ítem pendiente no se confirma', () => expect(codeOf(() => decideConfirm(pending, 'ORD-1'))).toBe('409 CART_ITEM_NOT_IN_PAYMENT'));
});

describe('EN_PAGO → PENDIENTE (pago rechazado)', () => {
  it('libera con la orden del ítem', () => expect(decideRelease(paying, 'ORD-1')).toBe('apply'));
  it('liberar dos veces responde igual', () => expect(decideRelease(pending, 'ORD-1')).toBe('noop'));
  it('otra orden no libera', () => expect(codeOf(() => decideRelease(paying, 'ORD-2'))).toBe('409 CART_ITEM_ALREADY_ORDERED'));
  it('un ítem comprado no se libera', () => expect(codeOf(() => decideRelease(bought, 'ORD-1'))).toBe('409 CART_ITEM_ALREADY_ORDERED'));
});

describe('edición', () => {
  it('un ítem pendiente se edita', () => expect(codeOf(() => assertEditable(pending))).toBeNull());
  it('un ítem en pago no', () => expect(codeOf(() => assertEditable(paying))).toBe('409 CART_ITEM_IN_PAYMENT'));
});
