import { addDays, BUSINESS_TIME_ZONE, money, normalizeTime, parseSlotId, slotId, todayIn, zonedToUtc } from './formats';

describe('formats · fechas y horas del contrato v3 (amplía formats.test.ts)', () => {
  it('P6 · zonedToUtc usa America/Guayaquil (UTC-5) por defecto', () => {
    expect(BUSINESS_TIME_ZONE).toBe('America/Guayaquil');
    expect(zonedToUtc('2026-12-31', '23:30:00').toISOString()).toBe('2027-01-01T04:30:00.000Z');
  });

  it('P6 · zonedToUtc acepta HH:mm y HH:mm:ss igual', () => {
    expect(zonedToUtc('2026-11-20', '09:00').getTime()).toBe(zonedToUtc('2026-11-20', '09:00:00').getTime());
  });

  it('P6 · todayIn cambia de día a medianoche de Ecuador, no de UTC', () => {
    expect(todayIn(BUSINESS_TIME_ZONE, new Date('2026-11-21T04:59:59Z'))).toBe('2026-11-20');
    expect(todayIn(BUSINESS_TIME_ZONE, new Date('2026-11-21T05:00:00Z'))).toBe('2026-11-21');
  });

  it('P6 · addDays cruza fin de mes y de año', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('P7 · slot_id del contrato: formato slot-YYYYMMDD-HHmm', () => {
    expect(slotId('2026-11-20', '09:05')).toBe('slot-20261120-0905');
    expect(parseSlotId('slot-20261120-0905')).toEqual({ date: '2026-11-20', time: '09:05:00' });
  });

  it('P7 · parseSlotId rechaza formatos ajenos al contrato', () => {
    for (const bad of ['slot-2026112-0905', 'SLOT-20261120-0905', 'slot-20261120-905', 'slot-20261131-1000', '20261120-0900', '']) {
      expect(parseSlotId(bad)).toBeNull();
    }
  });

  it('P7 · normalizeTime rechaza horas inválidas', () => {
    for (const bad of ['13:00 p.m.', '0:30 a.m.', '24:00', '10:60', 'diez']) expect(normalizeTime(bad)).toBeNull();
  });

  it('P7 · money redondea a 2 decimales sin error de coma flotante', () => {
    expect(money(1.005)).toBe(1.01);
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(45)).toBe(45);
  });
});
