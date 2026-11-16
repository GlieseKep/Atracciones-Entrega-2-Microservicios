import { expectContractHeaders, expectSchema, startE2E, type E2E } from './e2e-helpers';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { API_KEY, ATTRACTION, CUSTOMER } from '../../fixtures/v3/seed';

/** E2E · recorrido encadenado P6 → P7 → P8 → P10, más la compensación y la idempotencia de P7. */
describe('E2E v3 · compra, consulta y check-in (P6 → P7 → P8 → P10)', () => {
  let e2e: E2E;
  let created: Record<string, unknown>;
  const gw = () => request(e2e.stack.gatewayUrl);
  const body = (slot: 'holgado' | 'ultimo' | 'lleno', adults = 2) => ({
    attraction_id: ATTRACTION, slot_id: e2e.seed.slots[slot], date: e2e.seed.date, time: e2e.seed.times[slot], adult_count: adults, customer: CUSTOMER, payment_method: { method: 'CREDIT_CARD' },
  });
  const available = async (slot: 'holgado' | 'lleno') => {
    const res = await gw().get(`/api/v3/atracciones/${ATTRACTION}/disponibilidad?date=${e2e.seed.date}`);
    return res.body.time_slots.find((s: { slot_id: string }) => s.slot_id === e2e.seed.slots[slot]).available_slots as number;
  };

  beforeAll(async () => {
    e2e = await startE2E();
  }, 180_000);
  afterAll(async () => {
    await e2e?.close();
  });

  it('P7 · 201 con external_order_id, PNR y QR, y la disponibilidad del turno baja', async () => {
    const before = await available('holgado');
    const res = await gw().post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID()).send(body('holgado'));
    expect(res.status).toBe(201);
    expectContractHeaders(res);
    expectSchema(res.body, 'ReservaConfirmadaResponseV2');
    expect(res.body).toMatchObject({ status: 'CONFIRMED', external_order_id: expect.any(String), reservation_code: expect.stringMatching(/^DEC-/), voucher_qr_payload: expect.any(String) });
    expect(res.headers.location).toBe(`/api/v3/atracciones/reservas/${res.body.reservation_id}`);
    expect(await available('holgado')).toBe(before - 2);
    created = res.body;
  });

  it('P7 · turno agotado → 409 OUT_OF_STOCK y el cupo sigue igual (compensación)', async () => {
    const res = await gw().post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID()).send(body('lleno', 1));
    expect(res.status).toBe(409);
    expectContractHeaders(res);
    expect(res.body).toMatchObject({ type: 'https://booking.epn.edu.ec/errors/sin-cupos', code: 'OUT_OF_STOCK' });
    expect(await available('lleno')).toBe(0);
  });

  it('P7 · misma Idempotency-Key → misma respuesta, sin descontar otra vez', async () => {
    const key = randomUUID();
    const first = await gw().post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', key).send(body('holgado', 1));
    const before = await available('holgado');
    const second = await gw().post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', key).send(body('holgado', 1));
    expect(second.status).toBe(first.status);
    expect(second.body.reservation_id).toBe(first.body.reservation_id);
    expect(await available('holgado')).toBe(before);
  });

  it('P8 · consulta de la reserva recién creada', async () => {
    const res = await gw().get(`/api/v3/atracciones/reservas/${created.reservation_code}`).set('X-API-Key', API_KEY);
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'ReservaConfirmadaResponseV2');
    expect(res.body).toMatchObject({ reservation_id: created.reservation_id, status: 'CONFIRMED', date: e2e.seed.date });
  });

  it('P10 · check-in del titular con su documento y el QR', async () => {
    const res = await gw().post(`/api/v3/atracciones/reservas/${created.reservation_id}/checkin`).set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID())
      .send({ documento_identidad: CUSTOMER.document_id, codigo_voucher_qr: created.voucher_qr_payload, guia_codigo: 'GUIA-CARLOS-01' });
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'CheckinResponse');
    expect(res.body).toMatchObject({ estado: 'CHECKED_IN', titular_documento: CUSTOMER.document_id });
  });
});
