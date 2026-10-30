import type { EsbClient } from '@atracciones/platform';
import type { CouponValidationResponse, PromocionesContratoResponse } from '../contract';
import type { CouponOperation } from './esb-routes';

/**
 * Cliente de Coupon a través del ESB (operaciones de `MS_COUPON_ROUTES`). Las demás operaciones se llaman con `call`.
 *
 * - Order: `validateCoupon`. Un cupón que no aplica responde `valid = false`, y Order lo convierte en `422`.
 * - GraphQL: vista previa, cupones y acuerdo en el panel.
 */
export class CouponClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'coupon',
  ) {}

  call<T>(operation: CouponOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  validateCoupon(code: string, subtotal: number, date?: string): Promise<CouponValidationResponse> {
    return this.call('validateCoupon', date ? { code, subtotal, date } : { code, subtotal });
  }

  getAgreement(): Promise<PromocionesContratoResponse> {
    return this.call('getAgreement');
  }
}
