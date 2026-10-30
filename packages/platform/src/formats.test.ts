import { durationLabel, normalizeTime, parseSlotId, slotId, timeLabel, todayIn, zonedToUtc } from './formats';
import { AppError, fromProblem, toProblem } from './problem-details';

describe('formatos del contrato', () => {
  it('arma y separa el slot_id', () => {
    expect(slotId('2026-10-25', '10:30:00')).toBe('slot-20261025-1030');
    expect(parseSlotId('slot-20261025-1030')).toEqual({ date: '2026-10-25', time: '10:30:00' });
    expect(parseSlotId('slot-20260230-1030')).toBeNull();
    expect(parseSlotId('slot-20261025-2460')).toBeNull();
  });

  it('formatea y normaliza horas en 12 y 24 horas', () => {
    expect(timeLabel('10:30:00')).toBe('10:30 a.m.');
    expect(timeLabel('09:00:00')).toBe('09:00 a.m.');
    expect(timeLabel('12:00:00')).toBe('12:00 p.m.');
    expect(timeLabel('00:15:00')).toBe('12:15 a.m.');
    expect(timeLabel('13:05:00')).toBe('01:05 p.m.');
    expect(normalizeTime('10:30 a.m.')).toBe('10:30:00');
    expect(normalizeTime('1:05 p.m.')).toBe('13:05:00');
    expect(normalizeTime('12:15 AM')).toBe('00:15:00');
    expect(normalizeTime('10:30')).toBe('10:30:00');
    expect(normalizeTime('25:00')).toBeNull();
  });

  it('convierte la hora local de Ecuador a UTC', () => {
    expect(zonedToUtc('2026-10-25', '10:30:00', 'America/Guayaquil').toISOString()).toBe('2026-10-25T15:30:00.000Z');
    expect(zonedToUtc('2026-10-25', '22:00', 'America/Guayaquil').toISOString()).toBe('2026-10-26T03:00:00.000Z');
  });

  it('describe la duración y calcula la fecha local', () => {
    expect(durationLabel(7)).toBe('7 horas');
    expect(durationLabel(1)).toBe('1 hora');
    expect(durationLabel(1.5)).toBe('1.5 horas');
    // 2026-10-25T03:00Z todavía es 24 de octubre en Ecuador (UTC-5).
    expect(todayIn('America/Guayaquil', new Date('2026-10-25T03:00:00Z'))).toBe('2026-10-24');
  });
});

describe('ProblemDetails del contrato', () => {
  it('OUT_OF_STOCK usa el type y el título del ejemplo del contrato', () => {
    const p = toProblem(AppError.conflict('OUT_OF_STOCK', 'Sin cupos.'), '/api/v2/atracciones/reservas');
    expect(p).toEqual(expect.objectContaining({
      type: 'https://booking.epn.edu.ec/errors/sin-cupos',
      title: 'Cupos Agotados para el Turno Solicitado',
      status: 409,
      code: 'OUT_OF_STOCK',
      instance: '/api/v2/atracciones/reservas',
    }));
    expect(p.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('los errores no controlados no exponen detalles y el error se reconstruye en otro componente', () => {
    expect(toProblem(new Error('password de la base: secreto'))).toEqual(expect.objectContaining({ status: 500, code: 'INTERNAL_ERROR', detail: 'Se produjo un error inesperado.' }));
    const original = AppError.validation('Datos inválidos.', [{ name: 'customer.phone', reason: 'Formato inválido.' }]);
    const rebuilt = fromProblem(toProblem(original), 400);
    expect(rebuilt).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Datos inválidos.', invalidParams: [{ name: 'customer.phone', reason: 'Formato inválido.' }] });
  });
});
