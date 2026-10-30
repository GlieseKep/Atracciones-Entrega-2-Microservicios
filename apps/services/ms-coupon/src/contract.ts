/** Tipos del contrato `Plan/ms_coupon/ms_coupon-openapi.yaml`, compartidos por el servicio y por `CouponClient`. */

/** `PromocionesContratoResponse` (idéntico al contrato v3). */
export interface PromocionesContratoResponse {
  proveedor_id: string;
  nombre_comercial?: string;
  permite_promociones: boolean;
  porcentaje_descuento_maximo: number;
  destinos_habilitados: string[];
  fecha_acuerdo?: string;
  vigencia_hasta: string;
  condiciones_combo?: string;
}

/** `ActualizarPromocionesContratoRequest` (idéntico al contrato v3). */
export interface ActualizarPromocionesContratoRequest {
  permite_promociones: boolean;
  porcentaje_descuento_maximo: number;
  destinos_habilitados?: string[];
  vigencia_hasta?: string;
  condiciones_combo?: string;
  contacto_comercial?: { nombre?: string; email?: string; telefono?: string };
}

export type CouponType = 'PORCENTAJE' | 'FIJO';

/** `Coupon`. */
export interface CouponDto {
  code: string;
  type: CouponType;
  value: number;
  start_date: string;
  end_date: string | null;
  max_uses: number | null;
  active: boolean;
}

/** `CouponCreateRequest`. */
export interface CouponCreateRequestDto {
  code: string;
  type: CouponType;
  value: number;
  start_date: string;
  end_date?: string | null;
  max_uses?: number | null;
  active?: boolean;
}

/** `CouponUpdateRequest`: código, tipo y valor no cambian. */
export interface CouponUpdateRequestDto {
  start_date?: string;
  end_date?: string | null;
  max_uses?: number | null;
  active?: boolean;
}

/** `PaginationMetadata` (igual que el contrato v3). */
export interface PaginationMetadata {
  total_results: number;
  page: number;
  limit: number;
  total_pages: number;
  next_cursor: string | null;
}

/** `CouponPage`. */
export interface CouponPageDto {
  metadata: PaginationMetadata;
  data: CouponDto[];
}

export type CouponInvalidReason = 'COUPON_NOT_FOUND' | 'COUPON_INACTIVE' | 'COUPON_NOT_STARTED' | 'COUPON_EXPIRED';

/** `CouponValidationRequest`. */
export interface CouponValidationRequestDto {
  code: string;
  subtotal: number;
  currency?: string;
  date?: string;
}

/** `CouponValidationResponse`. */
export interface CouponValidationResponseDto {
  code: string;
  valid: boolean;
  reason: CouponInvalidReason | null;
  type?: CouponType;
  value?: number;
  discount_amount: number;
  currency: string;
  max_uses: number | null;
}

/** `GET /health` (ServiceHealth de la plataforma). */
export interface CouponHealthDto {
  status: 'UP' | 'DOWN';
  service: string;
  database_connected: boolean | null;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}
