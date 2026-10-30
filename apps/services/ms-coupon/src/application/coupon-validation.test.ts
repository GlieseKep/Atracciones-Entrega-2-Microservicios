import { discountFor, evaluateCoupon, type CouponRule } from './coupon-validation';

const base: CouponRule = { code: 'BIENVENIDA10', type: 'PORCENTAJE', value: 10, startDate: '2026-11-01', endDate: '2026-12-31', maxUses: 500, active: true };

describe('descuento', () => {
  it('porcentaje del subtotal', () => expect(discountFor('PORCENTAJE', 10, 75)).toBe(7.5));
  it('redondea a dos decimales', () => {
    expect(discountFor('PORCENTAJE', 15, 75.55)).toBe(11.33);
    expect(discountFor('PORCENTAJE', 33.33, 10)).toBe(3.33);
  });
  it('un monto fijo no pasa del subtotal', () => {
    expect(discountFor('FIJO', 20, 75)).toBe(20);
    expect(discountFor('FIJO', 100, 75)).toBe(75);
  });
  it('100 % deja el subtotal en cero', () => expect(discountFor('PORCENTAJE', 100, 42.1)).toBe(42.1));
});

describe('validación del cupón', () => {
  it('vigente y activo: aplica el descuento', () => expect(evaluateCoupon(base, 75, '2026-11-15')).toEqual({ valid: true, reason: null, discount: 7.5 }));
  it('el primer y el último día de vigencia cuentan', () => {
    expect(evaluateCoupon(base, 75, '2026-11-01').valid).toBe(true);
    expect(evaluateCoupon(base, 75, '2026-12-31').valid).toBe(true);
  });
  it('sin fecha de fin no vence', () => expect(evaluateCoupon({ ...base, endDate: null }, 75, '2030-01-01').valid).toBe(true));
  it.each([
    [null, '2026-11-15', 'COUPON_NOT_FOUND'],
    [{ ...base, active: false }, '2026-11-15', 'COUPON_INACTIVE'],
    [base, '2026-10-31', 'COUPON_NOT_STARTED'],
    [base, '2027-01-01', 'COUPON_EXPIRED'],
  ])('%#: %s → %s', (coupon, date, reason) => {
    expect(evaluateCoupon(coupon as CouponRule | null, 75, date)).toEqual({ valid: false, reason, discount: 0 });
  });
});
