import { describe, expect, it } from 'vitest';
import { ApiError, classifyProblem, errorMessage } from './api';
import { addDays, isNotPast, isValidIsoDate, isValidLocalTime, today } from './dates';
import { durationToMinutes, formatDuration, formatMoney } from './formatters';
import { IdempotencyKeyManager, stableStringify } from './idempotency';
import { safeReturnPath } from './routes';
import { billingFormSchema, reservationFormSchema } from './validation';

describe('formateo de precios y duraciones', () => {
  it('formatea dólares con el prefijo US$', () => {
    expect(formatMoney(9.5)).toBe('US$ 9,50');
    expect(formatMoney(75)).toBe('US$ 75');
  });

  it('convierte duraciones ISO 8601', () => {
    expect(durationToMinutes('PT2H30M')).toBe(150);
    expect(durationToMinutes('P1D')).toBe(1440);
    expect(durationToMinutes('2 horas')).toBeNull();
    expect(formatDuration('PT2H30M')).toBe('2 h 30 min');
    expect(formatDuration('P1D')).toBe('1 día');
  });
});

describe('validación de fechas y horarios', () => {
  it('valida fechas reales en formato YYYY-MM-DD', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('28/02/2026')).toBe(false);
  });

  it('rechaza fechas pasadas', () => {
    expect(isNotPast(today())).toBe(true);
    expect(isNotPast(addDays(today(), -1))).toBe(false);
  });

  it('valida horas HH:mm de 24 h', () => {
    expect(isValidLocalTime('09:00')).toBe(true);
    expect(isValidLocalTime('23:59')).toBe(true);
    expect(isValidLocalTime('24:00')).toBe(false);
    expect(isValidLocalTime('9:00')).toBe(false);
  });

  it('el formulario de reserva exige aceptar la política y un correo válido', () => {
    const base = { date: today(), time: '09:00', ticketCount: 2, customerName: 'Ana', customerEmail: 'ana@example.com' };
    expect(reservationFormSchema.safeParse({ ...base, acceptPolicy: true }).success).toBe(true);
    expect(reservationFormSchema.safeParse({ ...base, acceptPolicy: false }).success).toBe(false);
    expect(reservationFormSchema.safeParse({ ...base, customerEmail: 'no', acceptPolicy: true }).success).toBe(false);
    expect(reservationFormSchema.safeParse({ ...base, ticketCount: 101, acceptPolicy: true }).success).toBe(false);
  });

  it('no acepta un número de tarjeta como referencia de pago', () => {
    const base = { billingName: 'Ana', billingEmail: 'ana@example.com', billingAddress: 'Quito' };
    expect(billingFormSchema.safeParse({ ...base, paymentMethodReference: '4111111111111111' }).success).toBe(false);
    expect(billingFormSchema.safeParse({ ...base, paymentMethodReference: 'mi-tarjeta' }).success).toBe(true);
  });
});

describe('traducción de errores del API', () => {
  it('clasifica por código RFC 7807 antes que por estado', () => {
    expect(classifyProblem(409, { code: 'INSUFFICIENT_AVAILABILITY' })).toBe('availability');
    expect(classifyProblem(409, { code: 'IDEMPOTENCY_KEY_REUSED' })).toBe('idempotency');
    expect(classifyProblem(422, { code: 'PAYMENT_SIMULATION_REJECTED' })).toBe('payment');
  });

  it('distingue sesión expirada de no autenticado', () => {
    expect(classifyProblem(401, {}, true)).toBe('sessionExpired');
    expect(classifyProblem(401, {}, false)).toBe('unauthenticated');
    expect(classifyProblem(403)).toBe('forbidden');
    expect(classifyProblem(503)).toBe('server');
  });

  it('nunca muestra detalles internos', () => {
    const error = new ApiError('server', 500, { detail: 'NullReferenceException at Foo.cs:42', traceId: 'abc' });
    expect(errorMessage(error)).not.toContain('Foo.cs');
    expect(errorMessage(new Error('stack'))).toBe('Ocurrió un problema en el servidor. Inténtalo más tarde.');
  });
});

describe('Idempotency-Key', () => {
  it('reutiliza la clave al reintentar el mismo payload', () => {
    let n = 0;
    const manager = new IdempotencyKeyManager(() => `key-${++n}`);
    expect(manager.keyFor({ a: 1, b: 2 })).toBe('key-1');
    expect(manager.keyFor({ b: 2, a: 1 })).toBe('key-1');
  });

  it('genera otra clave para otro payload o tras completar', () => {
    let n = 0;
    const manager = new IdempotencyKeyManager(() => `key-${++n}`);
    manager.keyFor({ qty: 1 });
    expect(manager.keyFor({ qty: 2 })).toBe('key-2');
    manager.complete();
    expect(manager.keyFor({ qty: 2 })).toBe('key-3');
  });

  it('serializa de forma estable', () => {
    expect(stableStringify({ b: [1, { d: 1, c: 2 }], a: undefined })).toBe('{"b":[1,{"c":2,"d":1}]}');
  });
});

describe('redirecciones seguras', () => {
  it('solo permite rutas internas', () => {
    expect(safeReturnPath('/perfil?tab=reservas')).toBe('/perfil?tab=reservas');
    expect(safeReturnPath('https://evil.example')).toBe('/');
    expect(safeReturnPath('//evil.example')).toBe('/');
    expect(safeReturnPath(null)).toBe('/');
  });
});
