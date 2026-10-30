/** Tipos del contrato `Plan/ms_coupon/ms_coupon-openapi.yaml`. El acuerdo B2B usa los esquemas del contrato v3. */
export const COUPON_TYPES = ['PORCENTAJE', 'FIJO'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export type CouponRejection = 'COUPON_NOT_FOUND' | 'COUPON_INACTIVE' | 'COUPON_NOT_STARTED' | 'COUPON_EXPIRED';

export interface CouponDto {
  code: string;
  type: CouponType;
  value: number;
  start_date: string;
  end_date: string | null;
  max_uses: number | null;
  active: boolean;
}

export interface CouponPage {
  metadata: { total_results: number; page: number; limit: number; total_pages: number };
  data: CouponDto[];
}

export type CouponCreate = CouponDto;

/** Solo trae los campos enviados. */
export type CouponPatch = Partial<Pick<CouponDto, 'start_date' | 'end_date' | 'max_uses' | 'active'>>;

export interface CouponValidationRequest {
  code: string;
  subtotal: number;
  currency: string;
  date: string | null;
}

export interface CouponValidationResponse {
  cup_id: number | null;
  code: string;
  valid: boolean;
  reason: CouponRejection | null;
  type?: CouponType;
  value?: number;
  discount_amount: number;
  currency: string;
  max_uses?: number | null;
}

export interface PromocionesContratoResponse {
  proveedor_id: string;
  nombre_comercial?: string;
  permite_promociones: boolean;
  porcentaje_descuento_maximo: number;
  destinos_habilitados: string[];
  fecha_acuerdo: string;
  vigencia_hasta: string;
  condiciones_combo?: string;
}

/** `ActualizarPromocionesContratoRequest` validado. Lo que no se envía queda `undefined` y conserva su valor. */
export interface AgreementInput {
  permite: boolean;
  porcentaje: number;
  destinos?: string[];
  vigenciaHasta?: string;
  condiciones?: string | null;
  contactoNombre?: string | null;
  contactoCorreo?: string | null;
  contactoTelefono?: string | null;
}
