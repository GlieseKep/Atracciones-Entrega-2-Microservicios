/** Tipos del contrato `Plan/ms_review/ms_review-openapi.yaml`, compartidos por el servicio y por `ReviewClient`. */

/** `Breakdown`: pilares del contrato v3, escala 1–10 con un decimal. */
export interface BreakdownDto {
  limpieza: number;
  servicio: number;
  calidad_precio: number;
  puntualidad: number;
}

/** `ReviewCreateRequest`. */
export interface ReviewCreateRequestDto {
  reservation_id: string;
  score: number;
  breakdown: BreakdownDto;
  comment?: string | null;
}

/** `Review`. `hidden_reason` solo sale en "mis reseñas" y en moderación. */
export interface ReviewDto {
  id: number;
  attraction_id: string;
  author_name: string;
  verified_purchase: boolean;
  score: number;
  breakdown: BreakdownDto;
  comment: string | null;
  visible: boolean;
  hidden_reason?: string | null;
  created_at: string;
}

/** `RatingSummary`: también es el payload de `review.ResenaPublicada`. */
export interface RatingSummaryDto {
  attraction_id: string;
  score: number;
  review_count: number;
  breakdown: BreakdownDto;
  version: number;
}

/** `PaginationMetadata` (igual que el contrato v3). */
export interface PaginationMetadata {
  total_results: number;
  page: number;
  limit: number;
  total_pages: number;
  next_cursor: string | null;
}

/** `ReviewPage`. */
export interface ReviewPageDto {
  summary: RatingSummaryDto;
  metadata: PaginationMetadata;
  data: ReviewDto[];
}

/** `ModerationPage`. */
export interface ModerationPageDto {
  metadata: PaginationMetadata;
  data: ReviewDto[];
}

/** `VisibilityRequest`. */
export interface VisibilityRequestDto {
  visible: boolean;
  reason?: string | null;
}

/** `GET /health` (ServiceHealth de la plataforma). */
export interface ReviewHealthDto {
  status: 'UP' | 'DOWN';
  service: string;
  database_connected: boolean | null;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}
