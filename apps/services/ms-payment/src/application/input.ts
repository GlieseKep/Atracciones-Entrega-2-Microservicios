import { AppError, type InvalidParam } from '@atracciones/platform';
import { METHODS, STATES, type EstadoPago, type MetodoCodigo, type PagoInput, type TarjetaInput, type TransferenciaInput, type WebhookResult } from '../contract';

type Body = Record<string, unknown>;

const asBody = (body: unknown): Body => (body && typeof body === 'object' ? (body as Body) : {});
const BRANDS = ['VISA', 'MASTERCARD', 'AMEX'];

const stop = (errors: InvalidParam[]) => {
  if (errors.length > 0) throw AppError.validation('La solicitud tiene campos inválidos.', errors);
};

function parseCard(value: Body, errors: InvalidParam[]): TarjetaInput {
  if (!BRANDS.includes(value.marca as string)) errors.push({ name: 'tarjeta.marca', reason: `Debe ser ${BRANDS.join(', ')}.` });
  if (typeof value.ultimos4 !== 'string' || !/^[0-9]{4}$/.test(value.ultimos4)) errors.push({ name: 'tarjeta.ultimos4', reason: 'Debe tener 4 dígitos.' });
  const titular = typeof value.titular === 'string' ? value.titular.trim() : '';
  if (titular === '' || titular.length > 120) errors.push({ name: 'tarjeta.titular', reason: 'Es obligatorio, de hasta 120 caracteres.' });
  if (!Number.isInteger(value.mes) || (value.mes as number) < 1 || (value.mes as number) > 12) errors.push({ name: 'tarjeta.mes', reason: 'Debe estar entre 1 y 12.' });
  if (!Number.isInteger(value.anio) || (value.anio as number) < 2020 || (value.anio as number) > 2100) errors.push({ name: 'tarjeta.anio', reason: 'Debe estar entre 2020 y 2100.' });
  if (typeof value.pais !== 'string' || !/^[A-Za-z]{2}$/.test(value.pais)) errors.push({ name: 'tarjeta.pais', reason: 'Debe tener 2 letras.' });
  return { marca: value.marca as string, ultimos4: value.ultimos4 as string, titular, mes: value.mes as number, anio: value.anio as number, pais: String(value.pais).toUpperCase() };
}

/** Solo se leen los campos del contrato: un número completo o un CVV enviados por error no pasan de aquí. */
export function parsePayment(body: unknown): PagoInput {
  const b = asBody(body);
  const errors: InvalidParam[] = [];
  const numero = typeof b.numero === 'string' ? b.numero.trim() : '';
  if (numero === '' || numero.length > 30) errors.push({ name: 'numero', reason: 'Es obligatorio, de hasta 30 caracteres.' });
  if (!Number.isSafeInteger(b.ord_id) || (b.ord_id as number) < 1) errors.push({ name: 'ord_id', reason: 'Debe ser un entero positivo.' });
  if (!METHODS.includes(b.metodo as MetodoCodigo)) errors.push({ name: 'metodo', reason: `Debe ser ${METHODS.join(', ')}.` });
  if (typeof b.monto !== 'number' || !Number.isFinite(b.monto) || b.monto <= 0) errors.push({ name: 'monto', reason: 'Debe ser mayor que 0.' });
  if (b.canal !== 'WEB' && b.canal !== 'B2B') errors.push({ name: 'canal', reason: 'Debe ser WEB o B2B.' });
  const moneda = b.moneda === undefined ? 'USD' : b.moneda;
  if (typeof moneda !== 'string' || !/^[A-Z]{3}$/.test(moneda)) errors.push({ name: 'moneda', reason: 'Debe ser un código de 3 letras.' });
  const tarjeta = b.tarjeta === undefined || b.tarjeta === null ? null : parseCard(asBody(b.tarjeta), errors);
  stop(errors);
  const metodo = b.metodo as MetodoCodigo;
  const needsCard = metodo === 'CREDIT_CARD' || metodo === 'DEBIT_CARD';
  if (b.canal === 'WEB' && needsCard && !tarjeta) {
    throw AppError.unprocessable('CARD_DATA_REQUIRED', 'Una tarjeta en el canal WEB necesita sus datos.', [{ name: 'tarjeta', reason: 'Es obligatoria.' }]);
  }
  return { numero, ord_id: b.ord_id as number, metodo, monto: b.monto as number, moneda: moneda as string, canal: b.canal as PagoInput['canal'], tarjeta: needsCard ? tarjeta : null };
}

export function parseTransfer(body: unknown): TransferenciaInput {
  const b = asBody(body);
  const errors: InvalidParam[] = [];
  const text = (name: string, max: number) => {
    const value = typeof b[name] === 'string' ? (b[name] as string).trim() : '';
    if (value === '' || value.length > max) errors.push({ name, reason: `Es obligatorio, de hasta ${max} caracteres.` });
    return value;
  };
  const banco = text('banco', 60);
  const comprobante = text('numero_comprobante', 40);
  const fecha = b.fecha_transferencia;
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) {
    errors.push({ name: 'fecha_transferencia', reason: 'Debe ser una fecha YYYY-MM-DD.' });
  }
  const archivo = b.archivo_adjunto ?? null;
  if (archivo !== null && (typeof archivo !== 'string' || archivo.length > 500)) errors.push({ name: 'archivo_adjunto', reason: 'Debe ser texto de hasta 500 caracteres.' });
  stop(errors);
  return { banco, numero_comprobante: comprobante, fecha_transferencia: fecha as string, archivo_adjunto: archivo as string | null };
}

export function parseWebhook(body: unknown): WebhookResult {
  const b = asBody(body);
  if (typeof b.numero !== 'string' || (b.resultado !== 'APROBADO' && b.resultado !== 'RECHAZADO')) {
    throw AppError.validation('El webhook debe traer numero y resultado.');
  }
  return b as unknown as WebhookResult;
}

export function parseId(value: unknown, name = 'id'): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation(`'${name}' debe ser un entero positivo.`, [{ name, reason: 'Debe ser un entero positivo.' }]);
  return id;
}

export function parsePaymentQuery(query: Record<string, unknown>): { estado: EstadoPago | null; metodo: MetodoCodigo | null; page: number; limit: number } {
  const read = (name: string, fallback: number, max: number) => {
    if (query[name] === undefined) return fallback;
    const value = Number(query[name]);
    if (!Number.isInteger(value) || value < 1 || value > max) throw AppError.validation(`'${name}' debe ser un entero entre 1 y ${max}.`, [{ name, reason: 'Fuera de rango.' }]);
    return value;
  };
  if (query.estado !== undefined && !STATES.includes(query.estado as EstadoPago)) throw AppError.validation('Estado desconocido.', [{ name: 'estado', reason: `Debe ser ${STATES.join(', ')}.` }]);
  if (query.metodo !== undefined && !METHODS.includes(query.metodo as MetodoCodigo)) throw AppError.validation('Método desconocido.', [{ name: 'metodo', reason: `Debe ser ${METHODS.join(', ')}.` }]);
  return {
    estado: (query.estado as EstadoPago | undefined) ?? null,
    metodo: (query.metodo as MetodoCodigo | undefined) ?? null,
    page: read('page', 1, Number.MAX_SAFE_INTEGER),
    limit: read('limit', 20, 100),
  };
}
