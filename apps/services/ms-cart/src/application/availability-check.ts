import { AppError, parseSlotId, type EsbClient } from '@atracciones/platform';

interface Reference {
  id: string;
}

interface Availability {
  time_slots?: { slot_id: string; available_slots: number }[];
}

const slotNotFound = (slotId: string) => AppError.unprocessable('SLOT_NOT_FOUND', `El turno ${slotId} no existe o ya no se ofrece.`, [{ name: 'slot_id', reason: 'Turno desconocido.' }]);

/** Consulta a Catalog e Inventory al escribir. El carrito no reserva cupos: Inventory los vuelve a revisar al comprar. */
export class AvailabilityCheck {
  constructor(private readonly esb: EsbClient) {}

  /** ID público de la atracción, a partir del ID o el slug. */
  async attractionCode(id: string): Promise<string> {
    try {
      return (await this.esb.call<Reference>('catalog', 'getReference', { id })).id;
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        throw AppError.unprocessable('ATTRACTION_NOT_FOUND', `No existe la atracción ${id}.`, [{ name: 'attraction_id', reason: 'Atracción desconocida.' }]);
      }
      throw error;
    }
  }

  async assertSlot(codigo: string, slotId: string, tickets: number): Promise<void> {
    const date = parseSlotId(slotId)?.date as string;
    let availability: Availability;
    try {
      availability = await this.esb.call<Availability>('inventory', 'getAvailability', { id: codigo, date });
    } catch (error) {
      if (error instanceof AppError && error.status === 404) throw slotNotFound(slotId);
      throw error;
    }
    const slot = availability.time_slots?.find((item) => item.slot_id === slotId);
    if (!slot) throw slotNotFound(slotId);
    if (slot.available_slots < tickets) {
      throw AppError.unprocessable('SLOT_SOLD_OUT', `El turno ${slotId} tiene ${slot.available_slots} cupos disponibles.`, [{ name: 'slot_id', reason: 'Sin cupos suficientes.' }]);
    }
  }
}
