import type { EsbClient } from '@atracciones/platform';
import type { CheckinResponse, ReservaResponse } from '../contract';
import type { BookingOperation } from './esb-routes';

/** Cliente de Booking a través del ESB (operaciones de `MS_BOOKING_ROUTES`), para la Partner API y GraphQL. */
export class BookingClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'booking',
  ) {}

  private call<T>(operation: BookingOperation, input: object = {}, idempotencyKey?: string): Promise<T> {
    return this.esb.call<T>(this.service, operation, input, idempotencyKey ? { idempotencyKey } : {});
  }

  createReservation(input: object, idempotencyKey: string): Promise<ReservaResponse> {
    return this.call('createReservation', { ...input, idempotency_key: idempotencyKey }, idempotencyKey);
  }

  getReservation(id: string): Promise<ReservaResponse> {
    return this.call('getReservation', { id });
  }

  cancelReservation(id: string, input: { reason?: string; solicitante?: string }, idempotencyKey: string): Promise<ReservaResponse> {
    return this.call('cancelReservation', { id, ...input, idempotency_key: idempotencyKey }, idempotencyKey);
  }

  checkIn(id: string, input: object, idempotencyKey: string): Promise<CheckinResponse> {
    return this.call('checkIn', { id, ...input, idempotency_key: idempotencyKey }, idempotencyKey);
  }

  listEvents(filters: { after?: number; limit?: number; type?: string } = {}): Promise<{ events?: object[] }> {
    return this.call('listEvents', filters);
  }

  listReservations(filters: { todas?: boolean; estado?: string; page?: number; limit?: number } = {}): Promise<{ total_results: number; items: ReservaResponse[] }> {
    return this.call('listReservations', filters);
  }
}
