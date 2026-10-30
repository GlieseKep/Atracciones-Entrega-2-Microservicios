import { AppError, money } from '@atracciones/platform';
import type { Quote, QuoteLine, TicketType } from '../contract';
import type { TariffRow } from './price-table';

/** Orden de las líneas de la cotización (como `TarifaBaseDesglosada`). */
const ORDER: TicketType[] = ['ADULT', 'CHILD', 'SENIOR', 'STUDENT', 'INFANT'];

/**
 * Cotiza los boletos con las tarifas vigentes: precio unitario, subtotal por tipo y total (antes de descuentos e IVA).
 * Si falta la tarifa de un tipo pedido responde `PRICE_NOT_AVAILABLE` (FAILED_PRECONDITION → 422 en el ESB).
 */
export function buildQuote(attractionId: string, date: string, counts: Record<TicketType, number>, rows: TariffRow[]): Quote {
  const byType = new Map(rows.map((r) => [r.tar_tipo, r]));
  const missing = ORDER.filter((t) => counts[t] > 0 && !byType.has(t));
  if (missing.length) {
    throw AppError.unprocessable(
      'PRICE_NOT_AVAILABLE',
      `La atracción ${attractionId} no tiene tarifa vigente el ${date} para: ${missing.join(', ')}.`,
      missing.map((t) => ({ name: `${t.toLowerCase()}_count`, reason: 'Sin tarifa vigente para este tipo de boleto.' })),
    );
  }
  const lines: QuoteLine[] = ORDER.filter((t) => counts[t] > 0).map((t) => {
    const tariff = byType.get(t)!;
    return { ticket_type: t, quantity: counts[t], unit_price: tariff.tar_precio, subtotal: money(counts[t] * tariff.tar_precio), tariff_id: tariff.tar_id };
  });
  return {
    attraction_id: attractionId,
    date,
    currency: byType.get('ADULT')?.tar_moneda ?? rows[0]?.tar_moneda ?? 'USD',
    lines,
    ticket_count: lines.reduce((sum, l) => sum + l.quantity, 0),
    total: money(lines.reduce((sum, l) => sum + l.subtotal, 0)),
  };
}
