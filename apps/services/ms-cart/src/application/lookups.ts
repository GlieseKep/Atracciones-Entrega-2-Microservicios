import { AppError, type EsbClient } from '@atracciones/platform';
import type { SlotTime } from './slot';

/** Consultas a otros servicios para validar lo que el usuario agrega al carrito (siempre por el ESB). */
export interface CartLookups {
  /** ID público de la atracción activa (acepta ID público, slug o UUID); `null` si no existe o está inactiva. */
  attractionCode(id: string): Promise<string | null>;
  /** Si la atracción tiene a la venta un turno en esa fecha y hora. */
  slotOnSale(attractionCode: string, slot: SlotTime): Promise<boolean>;
}

const notFoundAsNull = async <T>(work: Promise<T>): Promise<T | null> => {
  try {
    return await work;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
};

/** Implementación con Catalog (`catalog.getAttraction`) e Inventory (`inventory.getAvailability`). */
export function esbLookups(esb: EsbClient): CartLookups {
  return {
    async attractionCode(id) {
      const detail = await notFoundAsNull(esb.call<{ codigo_publico: string }>('catalog', 'getAttraction', { id }, { timeoutMs: 2000 }));
      return detail?.codigo_publico.trim() ?? null;
    },
    async slotOnSale(attractionCode, slot) {
      const day = await notFoundAsNull(
        esb.call<{ turnos?: { hora: string }[] }>('inventory', 'getAvailability', { atraccion_codigo: attractionCode, fecha: slot.date }, { timeoutMs: 2000 }),
      );
      return (day?.turnos ?? []).some((t) => t.hora.slice(0, 5) === slot.time.slice(0, 5));
    },
  };
}
