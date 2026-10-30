/** Tipos del contrato `Plan/ms_cart/ms_cart-openapi.yaml`, compartidos por el servicio y por `CartClient`. */

export type CartItemStatus = 'PENDIENTE' | 'EN_PAGO' | 'COMPRADO';

/** `CartItem`. */
export interface CartItemDto {
  item_id: number;
  attraction_id: string;
  slot_id: string | null;
  date: string | null;
  time: string | null;
  adult_count: number;
  child_count: number;
  senior_count: number;
  student_count: number;
  infant_count: number;
  ticket_count: number;
  status: CartItemStatus;
  external_order_id: string | null;
  created_at: string | null;
}

/** `Cart`. */
export interface CartDto {
  id: number | null;
  active: boolean;
  items: CartItemDto[];
  item_count: number;
  ticket_count: number;
  created_at: string | null;
  updated_at: string | null;
  _links: { self: string; items: string };
}

/** `CartItemRequest`. */
export interface CartItemRequestDto {
  attraction_id: string;
  slot_id?: string | null;
  adult_count: number;
  child_count?: number;
  senior_count?: number;
  student_count?: number;
  infant_count?: number;
}

/** `CartItemUpdateRequest`: solo los campos que cambian; `slot_id: null` quita el turno. */
export type CartItemUpdateDto = Partial<Omit<CartItemRequestDto, 'attraction_id'>>;

/** `GET /health` (ServiceHealth de la plataforma). */
export interface CartHealthDto {
  status: 'UP' | 'DOWN';
  service: string;
  database_connected: boolean | null;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}
