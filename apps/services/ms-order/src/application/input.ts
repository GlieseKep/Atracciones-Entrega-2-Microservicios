import { AppError, type InvalidParam } from '@atracciones/platform';
import { METHODS, TICKET_TYPES, type CardData, type CreateOrderInput, type MetodoCodigo, type TicketLine, type TicketType } from '../contract';

type Message = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCreateOrder(request: Message): CreateOrderInput {
  const errors: InvalidParam[] = [];
  const key = String(request.idempotency_key ?? '');
  if (!UUID.test(key)) errors.push({ name: 'idempotency_key', reason: 'Debe ser un UUID.' });
  const atrId = Number(request.atr_id);
  if (!Number.isSafeInteger(atrId) || atrId < 1) errors.push({ name: 'atr_id', reason: 'Debe ser un entero positivo.' });
  const atrCodigo = String(request.atr_codigo ?? '');
  if (!/^[A-Za-z0-9]{12}$/.test(atrCodigo)) errors.push({ name: 'atr_codigo', reason: 'Debe ser el ID público de 12 caracteres.' });
  const nombre = String(request.atraccion_nombre ?? '').trim();
  if (nombre === '') errors.push({ name: 'atraccion_nombre', reason: 'Es obligatorio.' });
  if (!METHODS.includes(request.metodo as MetodoCodigo)) errors.push({ name: 'metodo', reason: `Debe ser ${METHODS.join(', ')}.` });
  const fecha = String(request.fecha ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) errors.push({ name: 'fecha', reason: 'Debe ser una fecha YYYY-MM-DD.' });
  const lines = (Array.isArray(request.boletos) ? request.boletos : []) as TicketLine[];
  if (lines.length === 0) errors.push({ name: 'boletos', reason: 'Debe tener al menos una línea.' });
  const types = new Set<string>();
  for (const line of lines) {
    if (!TICKET_TYPES.includes(line.ticket_type as TicketType) || types.has(line.ticket_type)) errors.push({ name: 'boletos.ticket_type', reason: 'Tipo desconocido o repetido.' });
    types.add(line.ticket_type);
    if (!Number.isInteger(line.cantidad) || line.cantidad < 1) errors.push({ name: 'boletos.cantidad', reason: 'Debe ser 1 o más.' });
  }
  const observaciones = String(request.observaciones ?? '').trim();
  if (observaciones.length > 500) errors.push({ name: 'observaciones', reason: 'Máximo 500 caracteres.' });
  if (errors.length > 0) throw AppError.validation('La orden tiene campos inválidos.', errors);
  const cartItem = Number(request.cart_item_id ?? 0);
  const coupon = String(request.coupon_code ?? '').trim();
  return {
    idempotencyKey: key.toLowerCase(),
    atrId,
    atrCodigo,
    atraccionNombre: nombre,
    boletos: lines.map((line) => ({ ticket_type: line.ticket_type, cantidad: line.cantidad })),
    metodo: request.metodo as MetodoCodigo,
    cartItemId: cartItem > 0 ? cartItem : null,
    couponCode: coupon === '' ? null : coupon,
    observaciones: observaciones === '' ? null : observaciones,
    fecha,
  };
}

export function parseOrderNumber(value: unknown): string {
  const numero = String(value ?? '');
  if (numero === '' || numero.length > 20) throw AppError.validation("'ord_numero' es obligatorio.", [{ name: 'ord_numero', reason: 'Es obligatorio.' }]);
  return numero;
}

/** `null` si el mensaje no trae tarjeta. */
export function parseCard(value: unknown): CardData | null {
  const card = value as CardData | null | undefined;
  return card?.ultimos4 ? card : null;
}
