/** Tipos de los mensajes de `pricing.proto` (nombres snake_case del contrato, como los entrega `loadProto`). */

export type TicketType = 'ADULT' | 'CHILD' | 'SENIOR' | 'INFANT' | 'STUDENT';

/** `PriceTable` (equivale a `TarifaBaseDesglosada` del contrato v3). Un tipo sin tarifa vigente no viene. */
export interface PriceTable {
  attraction_id: string;
  date: string;
  currency: string;
  adult?: number;
  child?: number;
  senior?: number;
  infant?: number;
  student?: number;
  from_price?: number;
}

export interface PriceTableList {
  items: PriceTable[];
}

export interface QuoteTicketsRequest {
  attraction_id: string;
  date: string;
  adult_count: number;
  child_count: number;
  senior_count: number;
  student_count: number;
  infant_count: number;
}

export interface QuoteLine {
  ticket_type: TicketType;
  quantity: number;
  unit_price: number;
  subtotal: number;
  tariff_id: number;
}

export interface Quote {
  attraction_id: string;
  date: string;
  currency: string;
  lines: QuoteLine[];
  ticket_count: number;
  total: number;
}

export interface Tariff {
  tariff_id: number;
  attraction_id: string;
  ticket_type: TicketType;
  price: number;
  currency: string;
  valid_from: string;
  /** Vacío = vigente sin fin. */
  valid_to: string;
  current: boolean;
}

export interface TariffList {
  items: Tariff[];
}

export interface SetTariffRequest {
  attraction_id: string;
  ticket_type: string;
  price: number;
  currency: string;
  valid_from: string;
  valid_to: string;
}

export interface SetPriceTableRequest {
  attraction_id: string;
  currency: string;
  valid_from: string;
  adult: number;
  child: number;
  senior: number;
  infant: number;
  student?: number;
}

export interface CloseTariffRequest {
  tariff_id: number;
  valid_to: string;
}

/** Carga del evento `TARIFA_ACTUALIZADA` (el relay agrega event_id, correlation_id y timestamp). */
export interface TariffUpdatedPayload {
  attraction_id: string;
  /** Desde cuándo rige el cambio. */
  valid_from: string;
  /** Tabla vigente hoy tras el cambio. */
  current_prices: PriceTable;
}

export interface PricingHealth {
  status: 'UP' | 'DOWN';
  service: string;
  database_connected: boolean | null;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}
