import { AppError, type EsbClient } from '@atracciones/platform';

export interface AppliedCoupon {
  cupId: number;
  descuento: number;
  maxUses: number | null;
}

interface CouponValidation {
  cup_id: number | null;
  valid: boolean;
  reason: string | null;
  discount_amount: number;
  max_uses?: number | null;
}

/** Un cupón que no aplica responde `valid = false`; aquí se convierte en `422`. El límite de usos se cuenta al guardar. */
export async function validateCoupon(esb: EsbClient, code: string, subtotal: number): Promise<AppliedCoupon> {
  const result = await esb.call<CouponValidation>('coupon', 'validateCoupon', { code, subtotal });
  if (!result.valid || result.cup_id === null) {
    throw AppError.unprocessable(result.reason ?? 'COUPON_INVALID', `El cupón ${code} no se puede aplicar.`, [{ name: 'coupon_code', reason: result.reason ?? 'No aplica.' }]);
  }
  return { cupId: result.cup_id, descuento: result.discount_amount, maxUses: result.max_uses ?? null };
}
