import { slotId } from '@atracciones/platform';
import { isPast, slotTime } from './slot';

describe('slot_id', () => {
  it('se convierte en fecha y hora y vuelve al mismo slot_id', () => {
    const time = slotTime('slot-20261025-1030');
    expect(time).toEqual({ date: '2026-10-25', time: '10:30:00' });
    expect(slotId(time!.date, time!.time)).toBe('slot-20261025-1030');
  });

  it.each(['slot-20261325-1030', 'slot-20260230-1030', 'slot-20261025-2460', 'slot-2026102-1030', 'turno-20261025-1030', ''])(
    'rechaza %p',
    (value) => expect(slotTime(value)).toBeNull(),
  );

  it('sin turno no hay fecha ni hora', () => {
    expect(slotTime(null)).toBeNull();
  });
});

describe('turno pasado (zona America/Guayaquil, UTC-5)', () => {
  // 2026-10-25 15:00 UTC = 10:00 en Ecuador
  const now = new Date('2026-10-25T15:00:00Z');
  const zone = 'America/Guayaquil';

  it('un día anterior ya pasó', () => expect(isPast({ date: '2026-10-24', time: '18:00:00' }, zone, now)).toBe(true));
  it('hoy a una hora que ya empezó, pasó', () => expect(isPast({ date: '2026-10-25', time: '10:00:00' }, zone, now)).toBe(true));
  it('hoy más tarde no pasó', () => expect(isPast({ date: '2026-10-25', time: '10:30:00' }, zone, now)).toBe(false));
  it('mañana no pasó', () => expect(isPast({ date: '2026-10-26', time: '08:00:00' }, zone, now)).toBe(false));
});
