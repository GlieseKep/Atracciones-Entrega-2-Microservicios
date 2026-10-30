import type { EsbClient } from '@atracciones/platform';

/** Filtro `fecha_inicio` y `fecha_fin`: Inventory indica qué atracciones tienen cupos en esas fechas. */
export async function filterAvailable(esb: EsbClient, codigos: string[], fechaInicio: string, fechaFin: string): Promise<string[]> {
  if (codigos.length === 0) return [];
  const result = await esb.call<{ atraccion_ids?: string[] }>('inventory', 'filterAvailableAttractions', {
    atraccion_ids: codigos,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
  });
  return result.atraccion_ids ?? [];
}
