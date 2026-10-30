/** Tipos del contrato `Plan/ms_pricing/pricing.proto`. Las tarifas incluyen IVA. */
export const TICKET_TYPES = ['ADULT', 'CHILD', 'SENIOR', 'INFANT', 'STUDENT'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const CURRENCY = 'USD';

export interface TicketLine {
  ticket_type: string;
  cantidad: number;
}

export interface QuoteTicketsRequest {
  attraction_id: string;
  date: string;
  boletos: TicketLine[];
}

export interface QuoteLine {
  ticket_type: TicketType;
  cantidad: number;
  unit_price: number;
  subtotal: number;
  tariff_id: number;
}

export interface Quote {
  attraction_id: string;
  date: string;
  currency: string;
  lines: QuoteLine[];
  total: number;
}

export interface GetPriceTableRequest {
  attraction_id: string;
  date: string;
}

export interface PriceTable {
  attraction_id: string;
  date: string;
  currency: string;
  adult: number;
  child: number;
  senior: number;
  infant: number;
  student?: number;
}

export interface Tariff {
  tariff_id: number;
  attraction_id: string;
  ticket_type: TicketType;
  price: number;
  currency: string;
  valid_from: string;
  valid_to: string;
  current: boolean;
}

export interface ListTariffsRequest {
  attraction_id: string;
  include_history: boolean;
}

export interface TariffList {
  items: Tariff[];
}

export interface SetPriceTableRequest {
  attraction_id: string;
  valid_from: string;
  adult: number;
  child: number;
  senior: number;
  student?: number | null;
}

/** `SetPriceTableRequest` validado. `INFANT` siempre vale 0. */
export interface PriceTableInput {
  codigo: string;
  validFrom: string;
  prices: Partial<Record<TicketType, number>>;
}
