import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { AvailabilityRepository } from '../src/persistence/availability-repository';
import { ScheduleRepository } from '../src/persistence/schedule-repository';
import { SeatRepository } from '../src/persistence/seat-repository';

const CODE = 'PRhu4UBTWPBC';
const TODAY = '2026-11-20';

describe('ms-inventory · persistencia en ms_inventory (P6, P7, P9)', () => {
  let db: MsDatabase;
  let schedules: ScheduleRepository;
  let seats: SeatRepository;
  let availability: AvailabilityRepository;

  beforeAll(async () => {
    db = await msDatabase('ms-inventory');
    schedules = new ScheduleRepository(db.dataSource);
    seats = new SeatRepository(db.dataSource);
    availability = new AvailabilityRepository(db.dataSource);
    await schedules.createSchedule(CODE, '10:30:00', 5, null);
    await schedules.createSchedule(CODE, '15:00:00', 1, null);
    await schedules.generateSlots(TODAY, 10);
  });
  afterAll(async () => {
    await db.drop();
  });

  const left = async (slot: string) => {
    const [row] = await db.dataSource.query(`SELECT dis_cupo_total - dis_cupo_reservado AS n FROM disponibilidad WHERE dis_slot_codigo = $1`, [slot]);
    return Number(row.n);
  };

  it('P7 · reserva con actualización condicional y outbox CupoBloqueado en la misma transacción', async () => {
    const res = await seats.reserve(CODE, 'slot-20261125-1030', 2, 'RES-ORD-A');
    expect(res).toMatchObject({ slot_id: 'slot-20261125-1030', cupos_disponibles: 3 });
    expect(await left('slot-20261125-1030')).toBe(3);
    const [event] = await db.dataSource.query(`SELECT tipo_evento, payload FROM outbox WHERE tipo_evento = 'CupoBloqueado' ORDER BY creado_en DESC LIMIT 1`);
    expect(event.payload).toMatchObject({ slot_id: 'slot-20261125-1030', cantidad: 2, cupos_disponibles: 3 });
    // misma clave: misma respuesta sin descontar otra vez
    await expect(seats.reserve(CODE, 'slot-20261125-1030', 2, 'RES-ORD-A')).resolves.toMatchObject({ cupos_disponibles: 3 });
    expect(await left('slot-20261125-1030')).toBe(3);
  });

  it('P7 · dos reservas concurrentes por el último cupo → solo una gana y la otra es 409 OUT_OF_STOCK', async () => {
    const results = await Promise.allSettled([
      seats.reserve(CODE, 'slot-20261126-1500', 1, 'RES-ORD-X'),
      seats.reserve(CODE, 'slot-20261126-1500', 1, 'RES-ORD-Y'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: 'OUT_OF_STOCK' });
    expect(await left('slot-20261126-1500')).toBe(0);
  });

  it('P9 · liberación devuelve los cupos una sola vez; clave desconocida no es error', async () => {
    await seats.reserve(CODE, 'slot-20261127-1030', 3, 'RES-ORD-L');
    await expect(seats.release('RES-ORD-L')).resolves.toEqual({ liberado: true, cupos_disponibles: 5 });
    await expect(seats.release('RES-ORD-L')).resolves.toEqual({ liberado: false, cupos_disponibles: 5 });
    await expect(seats.release('NUNCA-EXISTIO')).resolves.toEqual({ liberado: false, cupos_disponibles: 0 });
    const [{ n }] = await db.dataSource.query(`SELECT count(*)::int AS n FROM outbox WHERE tipo_evento = 'CupoLiberado'`);
    expect(n).toBe(1);
  });

  it('P6 · disponibilidad por fecha: solo turnos de ese día, ordenados, sin los que ya pasaron hoy', async () => {
    const day = await availability.slots(CODE, '2026-11-25', TODAY, '12:00:00');
    expect(day.map((s) => s.hora)).toEqual(['10:30:00', '15:00:00']);
    const today = await availability.slots(CODE, TODAY, TODAY, '12:00:00');
    expect(today.map((s) => s.hora)).toEqual(['15:00:00']);
    await expect(availability.withSeats([CODE], '2026-11-26', '2026-11-26', TODAY, '00:00:00')).resolves.toEqual([CODE]);
  });

  it('P7 · turno de otra atracción → 400 SLOT_TIME_MISMATCH; horario repetido → 409; generar otra vez no duplica', async () => {
    await expect(seats.reserve('OTRAATRACCIO', 'slot-20261125-1030', 1, 'k')).rejects.toMatchObject({ status: 400, code: 'SLOT_TIME_MISMATCH' });
    await expect(schedules.createSchedule(CODE, '10:30:00', 9, null)).rejects.toMatchObject({ status: 409, code: 'SCHEDULE_EXISTS' });
    await expect(schedules.generateSlots(TODAY, 10)).resolves.toBe(0);
  });
});
