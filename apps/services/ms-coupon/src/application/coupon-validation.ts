import { money } from '@atracciones/platform';
import type { CouponInvalidReason, CouponType } from '../contract';

export interface CouponRule {
  code: string;
  type: CouponType;
  value: number;
  startDate: string;
  endDate: string | null;
  maxUses: number | null;
  active: boolean;
}

export interface CouponEvaluation {
  valid: boolean;
  reason: CouponInvalidReason | null;
  discount: number;
}

/** Descuento sobre el subtotal: porcentaje del subtotal, o el monto fijo sin pasar del subtotal. Redondeo a 2 decimales. */
export function discountFor(type: CouponType, value: number, subtotal: number): number {
  return type === 'PORCENTAJE' ? money((subtotal * value) / 100) : money(Math.min(value, subtotal));
}

/**
 * Evalúa un cupón en una fecha. No cuenta usos: eso lo hace Order con `max_uses`, en la misma transacción que registra el
 * uso en `orden_cupon`.
 */
export function evaluateCoupon(coupon: CouponRule | null, subtotal: number, date: string): CouponEvaluation {
  const invalid = (reason: CouponInvalidReason): CouponEvaluation => ({ valid: false, reason, discount: 0 });
  if (!coupon) return invalid('COUPON_NOT_FOUND');
  if (!coupon.active) return invalid('COUPON_INACTIVE');
  if (date < coupon.startDate) return invalid('COUPON_NOT_STARTED');
  if (coupon.endDate && date > coupon.endDate) return invalid('COUPON_EXPIRED');
  return { valid: true, reason: null, discount: discountFor(coupon.type, coupon.value, subtotal) };
}
