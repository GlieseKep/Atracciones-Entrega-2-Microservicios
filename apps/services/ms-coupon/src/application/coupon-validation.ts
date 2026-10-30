import { money } from '@atracciones/platform';
import type { CouponDto, CouponRejection, CouponValidationRequest, CouponValidationResponse } from '../contract';

function rejection(coupon: CouponDto, date: string): CouponRejection | null {
  if (!coupon.active) return 'COUPON_INACTIVE';
  if (date < coupon.start_date) return 'COUPON_NOT_STARTED';
  return coupon.end_date !== null && date > coupon.end_date ? 'COUPON_EXPIRED' : null;
}

const discount = (coupon: CouponDto, subtotal: number) =>
  coupon.type === 'PORCENTAJE' ? money((subtotal * coupon.value) / 100) : money(Math.min(coupon.value, subtotal));

/**
 * No consume el cupón. La vigencia se compara con la fecha de compra. Los usos se cuentan en Order: aquí solo se devuelve
 * `max_uses`.
 */
export function validateCoupon(request: CouponValidationRequest, found: { id: number; coupon: CouponDto } | null, today: string): CouponValidationResponse {
  const base = { code: request.code, currency: request.currency };
  if (!found) return { ...base, cup_id: null, valid: false, reason: 'COUPON_NOT_FOUND', discount_amount: 0 };
  const { id, coupon } = found;
  const reason = rejection(coupon, request.date ?? today);
  return {
    ...base,
    cup_id: id,
    valid: reason === null,
    reason,
    type: coupon.type,
    value: coupon.value,
    discount_amount: reason === null ? discount(coupon, request.subtotal) : 0,
    max_uses: coupon.max_uses,
  };
}
