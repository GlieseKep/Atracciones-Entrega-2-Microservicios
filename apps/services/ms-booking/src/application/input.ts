import { AppError, currentContext, isValidCedula, isValidEmail, isValidFullName, isValidPhone, isValidRuc, normalizeTime, parseSlotId, todayIn, type InvalidParam } from '@atracciones/platform';
import type { CardData, CustomerInput, PurchaseInput, Solicitante } from '../contract';

type Message = Record<string, unknown>;

const METHODS = ['CREDIT_CARD', 'DEBIT_CARD', 'PAYPAL', 'TRANSFER'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (...values: unknown[]) => {
  for (const value of values) if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return '';
};

/** El gRPC trae la clave en el mensaje; por el ESB también puede llegar en el contexto. */
export function parseIdempotencyKey(value: unknown): string {
  const key = text(value, currentContext()?.idempotencyKey);
  if (!UUID.test(key)) throw AppError.validation('La cabecera Idempotency-Key debe ser un UUID.', [{ name: 'Idempotency-Key', reason: 'Debe ser un UUID.' }]);
  return key.toLowerCase();
}

/** Si falta el tipo, 10 dígitos es `CEDULA`, 13 es `RUC` y otro es `PASAPORTE`. */
function documentType(tipo: string, documento: string): CustomerInput['tipoDocumento'] {
  if (tipo === 'CEDULA' || tipo === 'PASAPORTE' || tipo === 'RUC') return tipo;
  if (/^\d{10}$/.test(documento)) return 'CEDULA';
  return /^\d{13}$/.test(documento) ? 'RUC' : 'PASAPORTE';
}

function validDocument(tipo: CustomerInput['tipoDocumento'], documento: string): boolean {
  if (tipo === 'CEDULA') return isValidCedula(documento);
  return tipo === 'RUC' ? isValidRuc(documento) : /^[A-Z0-9]{6,9}$/.test(documento);
}

/** Acepta los nombres del contrato, sus alias y los de la guía para socios. El formato de un dato es `422`. */
function parseCustomer(value: unknown): CustomerInput {
  const c = (value ?? {}) as Message;
  const nombre = text(c.full_name, c.nombre_completo, c.name);
  const correo = text(c.email, c.correo).toLowerCase();
  const telefono = text(c.phone, c.telefono).replace(/[\s-]/g, '');
  const documento = text(c.document_id, c.numero_documento).toUpperCase();
  const tipoDocumento = documentType(text(c.document_type, c.tipo_documento).toUpperCase(), documento);
  const problems: InvalidParam[] = [];
  if (!isValidFullName(nombre)) problems.push({ name: 'customer.full_name', reason: 'Debe tener al menos dos palabras.' });
  if (!isValidEmail(correo)) problems.push({ name: 'customer.email', reason: 'El correo no es válido.' });
  if (!isValidPhone(telefono)) problems.push({ name: 'customer.phone', reason: 'El formato debe ser internacional E.164 o celular de Ecuador (09XXXXXXXX).' });
  if (!validDocument(tipoDocumento, documento)) problems.push({ name: 'customer.document_id', reason: `Documento ${tipoDocumento} inválido.` });
  if (problems.length > 0) throw AppError.unprocessable('INVALID_CUSTOMER', 'Los datos del titular no son válidos.', problems);
  return { nombre, correo, telefono, tipoDocumento, documento };
}

const count = (value: unknown) => (Number.isInteger(value) ? (value as number) : 0);

export function parsePurchase(request: Message): PurchaseInput {
  const idempotencyKey = parseIdempotencyKey(request.idempotency_key);
  const attractionId = text(request.attraction_id, request.atraccion_id);
  const slotId = text(request.slot_id);
  const date = text(request.date, request.fecha);
  const time = text(request.time_24h, request.time, request.hora);
  const payment = (request.payment_method ?? {}) as Message;
  const errors: InvalidParam[] = [];
  if (attractionId === '') errors.push({ name: 'attraction_id', reason: 'Es obligatorio.' });
  if (!METHODS.includes(String(payment.method))) errors.push({ name: 'payment_method.method', reason: `Debe ser ${METHODS.join(', ')}.` });
  const slot = parseSlotId(slotId);
  if (!slot) errors.push({ name: 'slot_id', reason: 'Debe tener el formato slot-YYYYMMDD-HHMM.' });
  if (errors.length > 0) throw AppError.validation('La reserva tiene campos inválidos.', errors);
  if (slot?.date !== date || slot?.time !== normalizeTime(time)) {
    throw AppError.validation(`El turno ${slotId} no coincide con la fecha y la hora enviadas.`, undefined, 'SLOT_TIME_MISMATCH');
  }
  if (date < todayIn()) throw AppError.unprocessable('DATE_IN_PAST', 'La fecha de la actividad ya pasó.', [{ name: 'date', reason: 'Fecha pasada.' }]);
  const adultos = count(request.adult_count);
  if (adultos < 1) throw AppError.unprocessable('INVALID_TICKET_COUNT', 'Debe haber al menos un adulto.', [{ name: 'adult_count', reason: 'Debe ser 1 o más.' }]);
  const cartItem = Number(request.cart_item_id ?? 0);
  const tarjeta = request.tarjeta as CardData | null | undefined;
  return {
    idempotencyKey,
    attractionId,
    slotId,
    date,
    adultos,
    ninos: count(request.child_count),
    seniors: count(request.senior_count),
    infantes: count(request.infant_count),
    requerimientos: text(request.special_requirements).slice(0, 500) || null,
    customer: parseCustomer(request.customer),
    metodo: String(payment.method),
    sagaId: text(request.booking_reservation_id).slice(0, 40) || null,
    cartItemId: cartItem > 0 ? cartItem : null,
    couponCode: text(request.coupon_code) || null,
    tarjeta: tarjeta?.ultimos4 ? tarjeta : null,
  };
}

export function parseSolicitante(value: unknown): Solicitante {
  const solicitante = text(value) || 'CLIENTE';
  if (solicitante !== 'CLIENTE' && solicitante !== 'SAGA_ORCHESTRATOR' && solicitante !== 'ADMIN') {
    throw AppError.validation('solicitante debe ser CLIENTE, SAGA_ORCHESTRATOR o ADMIN.', [{ name: 'solicitante', reason: 'Valor no permitido.' }]);
  }
  return solicitante;
}

export const parseText = text;
