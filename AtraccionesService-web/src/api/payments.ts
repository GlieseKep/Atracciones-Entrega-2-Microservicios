import type { IsoDate } from '@/types/api';
import type { CouponValidation, PaymentMethodInfo } from '@/types/payment';
import { gql } from './client';

/** Métodos de pago de ms-payment. El cobro lo inicia Booking dentro de la compra. */
export const listPaymentMethods = (signal?: AbortSignal) => gql.query<PaymentMethodInfo[]>('paymentListMethods', {}, { signal });

/** Vista previa del descuento de un cupón (ms-coupon); Order lo vuelve a validar al crear la orden. */
export const validateCoupon = (body: { code: string; subtotal: number; currency: string; date: IsoDate | null }) =>
  gql.query<CouponValidation>('couponValidateCoupon', body);
