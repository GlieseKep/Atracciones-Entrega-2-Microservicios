import { AppError, money } from '@atracciones/platform';
import { TICKET_TYPES, type PriceTableInput, type QuoteTicketsRequest, type SetPriceTableRequest, type TicketType } from '../contract';

const invalid = (name: string, reason: string) => AppError.validation(`'${name}' no es válido: ${reason}`, [{ name, reason }]);

export function parseCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{12}$/.test(value)) throw invalid('attraction_id', 'Debe ser el ID público de 12 caracteres.');
  return value;
}

export function parseDate(value: unknown, name: string): string {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw invalid(name, 'Debe ser una fecha YYYY-MM-DD.');
  }
  return text;
}

export function parseBoletos(request: QuoteTicketsRequest): { type: TicketType; cantidad: number }[] {
  const lines = request.boletos ?? [];
  if (lines.length === 0) throw invalid('boletos', 'Debe tener al menos una línea.');
  const seen = new Set<string>();
  return lines.map((line) => {
    if (!TICKET_TYPES.includes(line.ticket_type as TicketType)) throw invalid('ticket_type', `Debe ser ${TICKET_TYPES.join(', ')}.`);
    if (seen.has(line.ticket_type)) throw invalid('ticket_type', `${line.ticket_type} está repetido.`);
    seen.add(line.ticket_type);
    if (!Number.isInteger(line.cantidad) || line.cantidad < 1) throw invalid('cantidad', 'Debe ser 1 o más.');
    return { type: line.ticket_type as TicketType, cantidad: line.cantidad };
  });
}

function price(value: unknown, name: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw invalid(name, positive ? 'Debe ser mayor que 0.' : 'No puede ser negativo.');
  }
  return money(value);
}

/** Una fecha vacía es hoy; una pasada se rechaza, porque cambiaría el precio de días ya vendidos. */
export function parseSetPriceTable(request: SetPriceTableRequest, today: string): PriceTableInput {
  const validFrom = request.valid_from ? parseDate(request.valid_from, 'valid_from') : today;
  if (validFrom < today) throw invalid('valid_from', 'No puede estar en el pasado.');
  const hasStudent = request.student !== undefined && request.student !== null;
  return {
    codigo: parseCode(request.attraction_id),
    validFrom,
    prices: {
      ADULT: price(request.adult, 'adult', true),
      CHILD: price(request.child, 'child'),
      SENIOR: price(request.senior, 'senior'),
      INFANT: 0,
      ...(hasStudent ? { STUDENT: price(request.student, 'student') } : {}),
    },
  };
}
