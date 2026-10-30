import type { EventEnvelope, EventHandler, Logger } from '@atracciones/platform';
import type { AttractionRepository } from '../persistence/attraction-repository';

export const EVENT_QUEUE = 'ms-catalog';
export const EVENT_PATTERNS = ['review.RESENA_PUBLICADA', 'pricing.TARIFA_ACTUALIZADA'];

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/**
 * Los eventos traen valores absolutos: repetir uno no cambia el resultado. Uno mal formado o de una atracción desconocida
 * se registra y se descarta, porque reintentarlo no lo arreglaría.
 */
export function eventHandler(attractions: AttractionRepository, logger: Logger): EventHandler {
  const discard = (event: EventEnvelope, reason: string) => logger.warn('evento descartado', { event_id: event.id, type: event.type, reason });

  async function onReview(event: EventEnvelope) {
    const d = event.data;
    if (![d.atr_id, d.promedio, d.limpieza, d.servicio, d.calidad_precio, d.puntualidad, d.numero_resenas].every(finite)) return discard(event, 'datos incompletos');
    const applied = await attractions.applyRatings(d.atr_id as number, {
      promedio: d.promedio as number,
      limpieza: d.limpieza as number,
      servicio: d.servicio as number,
      calidadPrecio: d.calidad_precio as number,
      puntualidad: d.puntualidad as number,
      numeroResenas: d.numero_resenas as number,
    });
    if (!applied) discard(event, 'atracción desconocida');
  }

  async function onTariff(event: EventEnvelope) {
    const prices = event.data.current_prices as Record<string, unknown> | undefined;
    const codigo = event.data.attraction_id;
    if (typeof codigo !== 'string' || !prices || ![prices.adult, prices.child, prices.senior, prices.infant].every(finite)) return discard(event, 'datos incompletos');
    const applied = await attractions.applyPrices(codigo, {
      moneda: typeof prices.currency === 'string' ? prices.currency : 'USD',
      adulto: prices.adult as number,
      nino: prices.child as number,
      senior: prices.senior as number,
      infante: prices.infant as number,
      estudiante: finite(prices.student) ? (prices.student as number) : null,
    });
    if (!applied) discard(event, 'atracción desconocida');
  }

  return async (event) => {
    if (event.type === 'RESENA_PUBLICADA') await onReview(event);
    else if (event.type === 'TARIFA_ACTUALIZADA') await onTariff(event);
  };
}
