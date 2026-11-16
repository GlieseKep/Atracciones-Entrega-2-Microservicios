import type { EventBus, EventEnvelope } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { FakeReservations, remoteSpy, reservationRow, silentLogger } from '../../test/fakes';
import type { EventRepository, EventRow } from '../persistence/event-repository';
import { EventPublisher } from './event-publisher';
import { EVENT_PATTERNS, paymentEventHandler } from './payment-events';

const envelope = (type: string, data: Record<string, unknown>): EventEnvelope => ({ specversion: '1.0', id: `e-${type}`, source: '/servicios/payment', type, subject: 'x', time: '', correlation_id: 'cid', data });

describe('ms-booking/payment-events · consumidor de pagos y reembolsos', () => {
  let reservations: FakeReservations;
  let remote: ReturnType<typeof remoteSpy>;
  let handler: ReturnType<typeof paymentEventHandler>;

  beforeEach(() => {
    reservations = new FakeReservations();
    remote = remoteSpy();
    handler = paymentEventHandler(reservations.asRepository(), remote.remote, silentLogger());
  });
  afterEach(() => jest.restoreAllMocks());

  it('se suscribe a PagoAprobado, PagoRechazado y ReembolsoEmitido', () => {
    expect(EVENT_PATTERNS).toEqual(['payment.PagoAprobado', 'payment.PagoRechazado', 'refund.ReembolsoEmitido']);
  });

  it('PagoAprobado confirma una PENDING; repetido no cambia nada ni duplica el evento', async () => {
    const row = reservations.add(reservationRow({ est_codigo: 'PENDING', ord_numero: 'ORD-11' }));
    await handler(envelope('PagoAprobado', { ord_id: 11 }));
    await handler(envelope('PagoAprobado', { ord_id: 11 }));
    expect(reservations.rows.get(row.res_id)!.est_codigo).toBe('CONFIRMED');
    expect(reservations.eventTypes()).toEqual(['RESERVA_CONFIRMADA']);
  });

  it('PagoRechazado cancela una PENDING y libera los cupos; sobre una CONFIRMED no hace nada', async () => {
    const pending = reservations.add(reservationRow({ est_codigo: 'PENDING', ord_numero: 'ORD-11' }));
    await handler(envelope('PagoRechazado', { ord_id: 11, motivo: 'Fondos insuficientes' }));
    expect(reservations.rows.get(pending.res_id)).toMatchObject({ est_codigo: 'CANCELLED', res_motivo_cancelacion: 'Fondos insuficientes' } as object);
    expect(remote.spy.releaseSeats).toHaveBeenCalledTimes(1);
    await handler(envelope('PagoRechazado', { ord_id: 11 }));
    expect(remote.spy.releaseSeats).toHaveBeenCalledTimes(1);
  });

  it('ReembolsoEmitido guarda el reembolso; evento sin ord_id u orden sin reserva se descarta', async () => {
    const row = reservations.add(reservationRow({ ord_numero: 'ORD-11' }));
    await handler(envelope('ReembolsoEmitido', { ord_id: 11, reembolso_id: 'RF-9', monto_acumulado: 45 }));
    expect(reservations.rows.get(row.res_id)).toMatchObject({ res_reembolso_id: 'RF-9', res_monto_reembolsado: '45' });
    await handler(envelope('PagoAprobado', {}));
    expect(remote.spy.order).toHaveBeenCalledTimes(1);
    remote.spy.order.mockResolvedValue({ orden: { ord_id: 12, ord_numero: 'SIN-RESERVA', det_id_adulto: 1, total: 1 }, usu_id: 1, cla_id: 1 });
    await expect(handler(envelope('PagoAprobado', { ord_id: 12 }))).resolves.toBeUndefined();
  });
});

describe('ms-booking/event-publisher · outbox → bus', () => {
  const row = (id: number, tipo = 'RESERVA_CREADA'): EventRow => ({
    evt_id: String(id), evt_uuid: `u-${id}`, evt_specversion: '1.0', evt_fuente: '/servicios/booking', evt_tipo: tipo as EventRow['evt_tipo'],
    evt_aggregate_id: 'DEC-1', evt_correlation_id: 'cid-1', evt_payload: { id }, evt_creado_en: new Date('2026-11-20T12:00:00Z'),
  });

  function setup(pending: EventRow[], publish: (key: string, e: EventEnvelope) => Promise<void> = async () => undefined) {
    const marked: string[] = [];
    const events = {
      pending: jest.fn(async () => pending.filter((r) => !marked.includes(r.evt_id))),
      markPublished: jest.fn(async (_m: EntityManager, id: string) => { marked.push(id); }),
    } as unknown as EventRepository;
    const dataSource = { transaction: (work: (m: EntityManager) => Promise<void>) => work({} as EntityManager) } as unknown as DataSource;
    const bus = { publish: jest.fn(publish) } as unknown as EventBus & { publish: jest.Mock };
    return { publisher: new EventPublisher(dataSource, events, bus, silentLogger(), 100), bus, marked };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('publica cada evento pendiente con la clave booking.<tipo> y el sobre CloudEvents', async () => {
    const { publisher, bus, marked } = setup([row(1), row(2, 'STOCK_ACTUALIZADO')]);
    publisher.start();
    await jest.advanceTimersByTimeAsync(100);
    publisher.stop();
    expect(bus.publish.mock.calls.map((c) => c[0])).toEqual(['booking.RESERVA_CREADA', 'booking.STOCK_ACTUALIZADO']);
    expect(bus.publish.mock.calls[0][1]).toMatchObject({ specversion: '1.0', id: 'u-1', type: 'RESERVA_CREADA', subject: 'DEC-1', correlation_id: 'cid-1', data: { id: 1 } });
    expect(marked).toEqual(['1', '2']);
  });

  it('si el bus falla no marca el evento y lo reintenta en la siguiente vuelta', async () => {
    let fail = true;
    const { publisher, bus, marked } = setup([row(1)], async () => { if (fail) throw new Error('bus caído'); });
    publisher.start();
    await jest.advanceTimersByTimeAsync(100);
    expect(marked).toEqual([]);
    fail = false;
    await jest.advanceTimersByTimeAsync(100);
    publisher.stop();
    expect(marked).toEqual(['1']);
    expect(bus.publish).toHaveBeenCalledTimes(2);
  });
});
