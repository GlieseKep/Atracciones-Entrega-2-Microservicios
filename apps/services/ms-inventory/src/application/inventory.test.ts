import { createLogger } from '@atracciones/platform';
import type { AvailableSlotRow } from '../persistence/availability-repository';
import type { ScheduleRepository } from '../persistence/schedule-repository';
import { nowTime, slotStatus, toAvailability } from './availability';
import { parseCode, parseDate, parseGuideId, parseSlotCode, parseTime, parseWeekdays } from './input';
import { SlotGenerator, WINDOW_DAYS } from './slot-generator';

const row = (hora: string, total: number, reservado: number): AvailableSlotRow =>
  ({ dis_slot_codigo: `slot-20261125-${hora.slice(0, 5).replace(':', '')}`, hora, dis_cupo_total: total, dis_cupo_reservado: reservado }) as AvailableSlotRow;

describe('ms-inventory/availability · P6 estados del turno', () => {
  it('umbral exacto: 4 cupos DISPONIBLE, 3 ULTIMOS_CUPOS (contrato: "3 o menos"), 1 ULTIMOS_CUPOS', () => {
    expect(slotStatus(4)).toBe('DISPONIBLE');
    expect(slotStatus(3)).toBe('ULTIMOS_CUPOS');
    expect(slotStatus(1)).toBe('ULTIMOS_CUPOS');
  });

  it('0 cupos o sobreventa (negativo) → AGOTADO', () => {
    expect(slotStatus(0)).toBe('AGOTADO');
    expect(slotStatus(-2)).toBe('AGOTADO');
  });

  it('aforo 0 → AGOTADO con available_slots 0', () => {
    expect(toAvailability('A1', '2026-11-25', [row('09:00:00', 0, 0)]).time_slots[0]).toMatchObject({ available_slots: 0, status: 'AGOTADO' });
  });

  it('DisponibilidadResponse con alias ES/EN, hora 12 h y total de cupos', () => {
    const res = toAvailability('PRhu4UBTWPBC', '2026-11-25', [row('10:30:00', 20, 5), row('15:00:00', 10, 8)]);
    expect(res).toMatchObject({ atraccion_id: 'PRhu4UBTWPBC', date: '2026-11-25', fecha: '2026-11-25', total_available_slots: 17, total_cupos_disponibles: 17 });
    expect(res.time_slots[0]).toEqual({
      slot_id: 'slot-20261125-1030', time: '10:30 a.m.', time_24h: '10:30:00', total_slots: 20, available_slots: 15, status: 'DISPONIBLE',
      hora: '10:30 a.m.', hora_24h: '10:30:00', cupos_totales: 20, cupos_disponibles: 15, estado: 'DISPONIBLE',
    });
    expect(res.time_slots[1].status).toBe('ULTIMOS_CUPOS');
    expect(res.turnos).toEqual(res.time_slots);
  });

  it('día sin turnos → listas vacías y total 0', () => {
    expect(toAvailability('A1', '2026-11-25', [])).toMatchObject({ total_available_slots: 0, time_slots: [] });
  });

  it('nowTime usa la hora de Ecuador (turno pasado del mismo día)', () => {
    expect(nowTime(new Date('2026-11-25T15:30:00Z'))).toBe('10:30:00');
  });
});

describe('ms-inventory/slot-generator · turnos hacia adelante', () => {
  const repo = (impl: () => Promise<number>) => ({ generateSlots: jest.fn(impl) }) as unknown as ScheduleRepository & { generateSlots: jest.Mock };
  const logger = () => {
    process.env.LOG_SILENT = 'true';
    return createLogger('pruebas');
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('horizonte de 90 días desde hoy en Ecuador', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-26T03:00:00Z') }); // todavía 25 en Ecuador
    const schedules = repo(async () => 0);
    await new SlotGenerator(schedules, logger()).generate();
    expect(WINDOW_DAYS).toBe(90);
    expect(schedules.generateSlots).toHaveBeenCalledWith('2026-11-25', 90, null);
  });

  it('generar para una sola atracción (al crear su horario)', async () => {
    const schedules = repo(async () => 3);
    await expect(new SlotGenerator(schedules, logger()).generate('PRhu4UBTWPBC')).resolves.toBe(3);
    expect(schedules.generateSlots.mock.calls[0][2]).toBe('PRhu4UBTWPBC');
  });

  it('start genera de inmediato y luego cada 6 h', async () => {
    jest.useFakeTimers();
    const schedules = repo(async () => 0);
    const generator = new SlotGenerator(schedules, logger());
    await generator.start();
    expect(schedules.generateSlots).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(6 * 60 * 60_000);
    generator.stop();
    expect(schedules.generateSlots).toHaveBeenCalledTimes(2);
  });

  it('un error de la base no detiene el generador', async () => {
    const generator = new SlotGenerator(repo(async () => { throw new Error('base caída'); }), logger());
    await expect(generator.start()).resolves.toBeUndefined();
    generator.stop();
  });
});

describe('ms-inventory/input · validación de entradas', () => {
  it('código público de 12 caracteres y slot_id del contrato', () => {
    expect(parseCode('PRhu4UBTWPBC')).toBe('PRhu4UBTWPBC');
    expect(() => parseCode('corto')).toThrow(expect.objectContaining({ status: 400 }));
    expect(parseSlotCode('slot-20261125-1030')).toBe('slot-20261125-1030');
    expect(() => parseSlotCode('slot-2026-1030')).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('fecha YYYY-MM-DD real y hora en 12 o 24 h', () => {
    expect(parseDate('2028-02-29', 'date')).toBe('2028-02-29');
    expect(() => parseDate('2026-02-30', 'date')).toThrow(expect.objectContaining({ invalidParams: [expect.objectContaining({ name: 'date' })] }));
    expect(parseTime('3:00 p.m.')).toBe('15:00:00');
    expect(() => parseTime('25:00')).toThrow();
  });

  it('guía: 0 o vacío automático, -1 sin guía, negativo inválido', () => {
    expect(parseGuideId(0)).toBeNull();
    expect(parseGuideId('')).toBeNull();
    expect(parseGuideId(-1)).toBe(-1);
    expect(() => parseGuideId(-5)).toThrow();
  });

  it('días de la semana ISO sin repetir y ordenados', () => {
    expect(parseWeekdays([7, 1, 1, 3])).toEqual([1, 3, 7]);
    expect(() => parseWeekdays([0])).toThrow();
    expect(parseWeekdays(undefined)).toEqual([]);
  });
});
