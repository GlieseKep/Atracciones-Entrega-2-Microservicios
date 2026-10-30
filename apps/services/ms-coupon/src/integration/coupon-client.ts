import type { EsbClient } from '@atracciones/platform';
import type {
  ActualizarPromocionesContratoRequest,
  CouponCreateRequestDto,
  CouponDto,
  CouponHealthDto,
  CouponPageDto,
  CouponUpdateRequestDto,
  CouponValidationRequestDto,
  CouponValidationResponseDto,
  PromocionesContratoResponse,
} from '../contract';
import type { CouponOperation } from './esb-routes';

/**
 * Cliente de Coupon a través del ESB (operaciones de `MS_COUPON_ROUTES`). Usa el principal de la petición en curso: el
 * ESB lo reenvía. Los errores llegan como `AppError` con el estado y el código del servicio (p. ej. 409
 * `COUPON_CODE_EXISTS`).
 *
 * - Partner API: `getPromotionAgreement` (socio con `promotions:read`) y `updatePromotionAgreement` (`promotions:write`).
 * - GraphQL: administración de cupones (rol ADMIN) y `validateCoupon` para la vista previa del checkout.
 * - Order: `validateCoupon` con su cuenta de servicio; comprueba `max_uses` contra `orden_cupon` en su transacción.
 */
export class CouponClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'coupon',
  ) {}

  private call<T>(operation: CouponOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  health(): Promise<CouponHealthDto> {
    return this.call('health');
  }

  // Acuerdo B2B (contrato v3) -------------------------------------------------

  getPromotionAgreement(): Promise<PromocionesContratoResponse> {
    return this.call('getPromotionAgreement');
  }

  updatePromotionAgreement(answers: ActualizarPromocionesContratoRequest): Promise<PromocionesContratoResponse> {
    return this.call('updatePromotionAgreement', answers);
  }

  // Cupones --------------------------------------------------------------------

  listCoupons(filters: { active?: boolean; code?: string; page?: number; limit?: number } = {}): Promise<CouponPageDto> {
    return this.call('listCoupons', filters);
  }

  createCoupon(coupon: CouponCreateRequestDto): Promise<CouponDto> {
    return this.call('createCoupon', coupon);
  }

  getCoupon(code: string): Promise<CouponDto> {
    return this.call('getCoupon', { code });
  }

  updateCoupon(code: string, changes: CouponUpdateRequestDto): Promise<CouponDto> {
    return this.call('updateCoupon', { ...changes, code });
  }

  /** No consume el cupón: devuelve si aplica, el descuento y `max_uses` para que Order controle los usos. */
  validateCoupon(request: CouponValidationRequestDto): Promise<CouponValidationResponseDto> {
    return this.call('validateCoupon', request);
  }
}
