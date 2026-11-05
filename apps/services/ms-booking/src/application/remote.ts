import { AppError, type EsbClient } from '@atracciones/platform';
import type { CardData } from '../contract';

export interface Logistics {
  atraccion_id: string;
  nombre: string;
  punto_encuentro: string;
  free_cancellation: boolean;
  deadline_hours: number;
  guia: { gui_id: number; nombre: string } | null;
}

export interface OrderSummary {
  ord_id: number;
  ord_numero: string;
  det_id_adulto: number;
  total: number;
}

export interface OrderDetail {
  orden: OrderSummary;
  usu_id: number;
  cla_id: number;
}

export interface Slot {
  dis_id: number;
  atraccion_id: string;
  slot_id: string;
  fecha: string;
  hora: string;
}

interface Reference {
  atr_id: number;
  id: string;
  nombre: string;
}

export interface Refund {
  reembolso_id: string;
  monto_reembolsado: number;
}

/** Llamadas a los demás servicios por el ESB. */
export class Remote {
  constructor(private readonly esb: EsbClient) {}

  async reference(id: string): Promise<Reference> {
    try {
      return await this.esb.call<Reference>('catalog', 'getReference', { id });
    } catch (error) {
      if (error instanceof AppError && error.status === 404) throw AppError.unprocessable('ATTRACTION_NOT_FOUND', `No existe la atracción ${id}.`, [{ name: 'attraction_id', reason: 'Atracción desconocida.' }]);
      throw error;
    }
  }

  logistics(id: string, guiId: number | null): Promise<Logistics> {
    return this.esb.call<Logistics>('catalog', 'getLogistics', guiId === null ? { id } : { id, gui_id: guiId });
  }

  /** `null` si la atracción ya no está publicada o el guía ya no está disponible. */
  async logisticsOrNull(id: string, guiId: number | null): Promise<Logistics | null> {
    try {
      return await this.logistics(id, guiId);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return null;
      throw error;
    }
  }

  /** Permiso de un `OPERADOR`: Catalog responde `403` si la atracción es de otro operador. */
  async assertOperatorOf(atraccionId: string): Promise<void> {
    await this.esb.call('catalog', 'adminGetAttraction', { id: atraccionId });
  }

  createOrder(input: object): Promise<OrderSummary> {
    return this.esb.call<OrderSummary>('order', 'createOrder', input);
  }

  startPayment(ordNumero: string, tarjeta: CardData | null): Promise<{ estado_pago: string }> {
    return this.esb.call('order', 'startPayment', tarjeta ? { ord_numero: ordNumero, tarjeta } : { ord_numero: ordNumero });
  }

  cancelOrder(ordNumero: string, motivo: string): Promise<unknown> {
    return this.esb.call('order', 'cancelOrder', { ord_numero: ordNumero, motivo });
  }

  order(reference: { ord_id?: number; ord_numero?: string }): Promise<OrderDetail> {
    return this.esb.call<OrderDetail>('order', 'getOrder', reference);
  }

  myOrders(page: number, limit: number): Promise<{ total_results?: number; items?: { ord_numero: string }[] }> {
    return this.esb.call('order', 'listOrders', { page, limit });
  }

  /** `gui_id`: guía del turno en Inventory (`null` o 0 = sin guía). */
  reserveSeats(atraccionId: string, slotId: string, cantidad: number, clave: string): Promise<{ dis_id: number; cupos_disponibles: number; gui_id?: number | null }> {
    return this.esb.call('inventory', 'reserveSeats', { atraccion_id: atraccionId, slot_id: slotId, cantidad, clave_idempotencia: clave });
  }

  releaseSeats(clave: string): Promise<{ cupos_disponibles: number }> {
    return this.esb.call('inventory', 'releaseSeats', { clave_idempotencia: clave });
  }

  async slot(disId: number): Promise<Slot> {
    return (await this.slots([disId]))[0];
  }

  async slots(ids: number[]): Promise<Slot[]> {
    return (await this.esb.call<{ items?: Slot[] }>('inventory', 'getSlotsByIds', { dis_ids: ids })).items ?? [];
  }

  /**
   * Turista de `cliente_api` (Identity) para el titular de una compra de socio: lo reutiliza si ya existe (por correo o
   * identificación) o lo registra. Nunca lo duplica.
   */
  async ensureClient(customer: { nombre: string; correo: string; documento: string; telefono: string }): Promise<number> {
    const client = await this.esb.call<{ client_id: string }>('identity', 'ensureClient', {
      nombre: customer.nombre,
      email: customer.correo,
      identificacion: customer.documento,
      telefono: customer.telefono,
    });
    return Number(client.client_id);
  }

  /** `POST /api/v3/reservas/{external_order_id}/checkin` de Booking Central, por el ESB (con su `X-API-Key`). */
  notifyCheckin(payload: object): Promise<unknown> {
    return this.esb.call('bookingCore', 'notifyCheckin', payload, { timeoutMs: 10_000 });
  }

  /** `null` si no hay un pago aprobado que devolver. */
  async refund(ordId: number, motivo: string, clave: string): Promise<Refund | null> {
    try {
      return await this.esb.call<Refund>('refund', 'createRefund', { ord_id: ordId, motivo }, { idempotencyKey: clave });
    } catch (error) {
      if (error instanceof AppError && error.code === 'NO_APPROVED_PAYMENT') return null;
      throw error;
    }
  }
}

/** Clave con la que se descuentan y reintegran los cupos de una orden. */
export const seatKey = (ordNumero: string) => `RES-${ordNumero}`;
