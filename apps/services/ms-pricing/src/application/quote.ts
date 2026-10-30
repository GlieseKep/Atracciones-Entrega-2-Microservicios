import { AppError, money } from '@atracciones/platform';
import { CURRENCY, type Quote, type TicketType } from '../contract';
import type { TariffRow } from '../persistence/pricing-repository';

/** Un tipo sin tarifa responde `PRICE_NOT_AVAILABLE`, nunca un precio de $0. */
export function buildQuote(codigo: string, date: string, boletos: { type: TicketType; cantidad: number }[], rows: TariffRow[]): Quote {
  const lines = boletos.map(({ type, cantidad }) => {
    const row = rows.find((item) => item.tar_tipo === type);
    if (!row) throw AppError.unprocessable('PRICE_NOT_AVAILABLE', `No hay tarifa ${type} vigente el ${date}.`);
    const unitPrice = Number(row.tar_precio);
    return { ticket_type: type, cantidad, unit_price: unitPrice, subtotal: money(unitPrice * cantidad), tariff_id: Number(row.tar_id) };
  });
  return {
    attraction_id: codigo,
    date,
    currency: rows[0]?.tar_moneda ?? CURRENCY,
    lines,
    total: money(lines.reduce((sum, line) => sum + line.subtotal, 0)),
  };
}
