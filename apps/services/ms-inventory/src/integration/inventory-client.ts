import type { EsbClient } from '@atracciones/platform';
import type { DisponibilidadResponse, ReleaseSeatsResponse, ReserveSeatsRequest, ReserveSeatsResponse, Slot } from '../contract';
import type { InventoryOperation } from './esb-routes';

/**
 * Cliente de Inventory a través del ESB (operaciones de `MS_INVENTORY_ROUTES`). Las demás operaciones se llaman con `call`.
 *
 * - Booking: `reserveSeats`, `releaseSeats` y `getSlotsByIds`.
 * - Partner API: `getAvailability`.
 * - GraphQL: horarios, turnos y fechas bloqueadas.
 */
export class InventoryClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'inventory',
  ) {}

  call<T>(operation: InventoryOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  getAvailability(id: string, date: string): Promise<DisponibilidadResponse> {
    return this.call('getAvailability', { id, date });
  }

  reserveSeats(request: ReserveSeatsRequest): Promise<ReserveSeatsResponse> {
    return this.call('reserveSeats', request);
  }

  releaseSeats(clave: string): Promise<ReleaseSeatsResponse> {
    return this.call('releaseSeats', { clave_idempotencia: clave });
  }

  async getSlotsByIds(ids: number[]): Promise<Slot[]> {
    return (await this.call<{ items?: Slot[] }>('getSlotsByIds', { dis_ids: ids })).items ?? [];
  }
}
