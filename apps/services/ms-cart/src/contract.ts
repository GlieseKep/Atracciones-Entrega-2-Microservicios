/** Tipos del contrato `Plan/ms_cart/ms_cart-openapi.yaml`. Las cantidades usan los campos de `CreateReservaRequestV3`. */
export type ItemStatus = 'PENDIENTE' | 'EN_PAGO' | 'COMPRADO';

export interface TicketCounts {
  adult_count: number;
  child_count: number;
  senior_count: number;
  student_count: number;
  infant_count: number;
}

export const ticketTotal = (c: TicketCounts) => c.adult_count + c.child_count + c.senior_count + c.student_count + c.infant_count;

export interface CartItemInput extends TicketCounts {
  attraction_id: string;
  slot_id: string | null;
}

/** Solo trae los campos enviados. `slot_id: null` quita el turno. */
export type CartItemPatch = Partial<TicketCounts> & { slot_id?: string | null };

export interface CartItemDto extends TicketCounts {
  item_id: number;
  attraction_id: string;
  slot_id: string | null;
  date: string | null;
  time: string | null;
  ticket_count: number;
  status: ItemStatus;
  external_order_id: string | null;
  created_at: string;
}

export interface CartDto {
  id: number | null;
  active: boolean;
  items: CartItemDto[];
  item_count: number;
  ticket_count: number;
  created_at: string | null;
  updated_at: string | null;
}
