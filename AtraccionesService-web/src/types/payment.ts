import type { PaymentMethodCode } from './booking';

/** Métodos de pago de ms-payment (`paymentListMethods`). */
export interface PaymentMethodInfo {
  id: number;
  codigo: PaymentMethodCode;
  nombre: string;
  /** El método pide datos de la tarjeta (marca y últimos 4 dígitos). */
  requiere_datos: boolean;
}

/** `couponValidateCoupon`. */
export interface CouponValidation {
  code: string;
  valid: boolean;
  reason: 'COUPON_NOT_FOUND' | 'COUPON_INACTIVE' | 'COUPON_NOT_STARTED' | 'COUPON_EXPIRED' | null;
  type?: 'PORCENTAJE' | 'FIJO';
  value?: number;
  discount_amount: number;
  currency: string;
}
