import { expectContractHeaders, expectSchema, startE2E, type E2E } from './e2e-helpers';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { API_KEY, ATTRACTION, CUSTOMER } from '../../fixtures/v3/seed';

/** E2E · recorrido encadenado P7 → P9 → P12: compra, cancelación de la saga de Booking y feed del outbox. */
describe('E2E v3 · cancelación y feed (P7 → P9 → P12)', () => {
  let e2e: E2E;
  let created: Record<string, string>;
  const gw = () => request(e2e.stack.gatewayUrl);
  const available = async () => {
    const res = await gw().get(`/api/v3/atracciones/${ATTRACTION}/disponibilidad?date=${e2e.seed.date}`);
    return res.body.time_slots.find((s: { slot_id: string }) => s.slot_id === e2e.seed.slots.holgado).available_slots as number;
  };

  beforeAll(async () => {
    e2e = await startE2E();
    const res = await request(e2e.stack.gatewayUrl).post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID())
      .send({ attraction_id: ATTRACTION, slot_id: e2e.seed.slots.holgado, date: e2e.seed.date, time: e2e.seed.times.holgado, adult_count: 3, customer: CUSTOMER, payment_method: { method: 'CREDIT_CARD' } });
    expect(res.status).toBe(201);
    created = res.body;
  }, 180_000);
  afterAll(async () => {
    await e2e?.close();
  });

  it('P9 · SAGA_ORCHESTRATOR: reembolso del 100 % y la disponibilidad sube', async () => {
    const before = await available();
    const res = await gw().post(`/api/v3/atracciones/reservas/${created.reservation_id}/cancel`).set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID())
      .send({ reason: 'SAGA_COMPENSATION_PARTNER_FAILURE', solicitante: 'SAGA_ORCHESTRATOR' });
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'ReservaConfirmadaResponseV2');
    expect(res.body).toMatchObject({ status: 'CANCELLED', monto_reembolsado: Number(created.total_price) });
    expect(await available()).toBe(before + 3);
  });

  it('P12 · tras la compra y la cancelación aparecen RESERVA_CREADA, RESERVA_CONFIRMADA, STOCK_ACTUALIZADO y RESERVA_CANCELADA', async () => {
    const res = await gw().get('/api/v3/atracciones/eventos?after=0&limit=200').set('X-API-Key', API_KEY);
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'OutboxEventItem', true);
    const mine = res.body.filter((e: { aggregate_id: string }) => e.aggregate_id === created.reservation_code).map((e: { event_type: string }) => e.event_type);
    expect(mine).toEqual(['RESERVA_CREADA', 'STOCK_ACTUALIZADO', 'RESERVA_CONFIRMADA', 'RESERVA_CANCELADA', 'STOCK_ACTUALIZADO']);
  });
});
