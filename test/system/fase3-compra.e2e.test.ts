import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CEDULA, cuposDisponibles, reservar, reservaBody, slot, tomorrow } from './booking-flow';
import { startSystem, userToken, type System } from './harness';

/** Fase 3 (plan §8): saga de compra `POST /atracciones/reservas` y `GET /reservas/{id}`. */
describe('Fase 3 — Saga de compra', () => {
  let system: System;
  let apiKey: string;
  const http = () => request(system.gatewayUrl);

  beforeAll(async () => {
    system = await startSystem({ sagas: true });
    apiKey = (await system.identity.accounts.createApiKey({ nombre: 'booking-prototipo', email: 'integracion@booking.test' })).apiKey;
  });
  afterAll(async () => {
    await system?.close();
  });

  it('201 con todos los campos del contrato y Location; GET inmediato de la Location → 200', async () => {
    const antes = await cuposDisponibles(system, 'PRhu4UBTWPBC', tomorrow(), '10:30');
    const res = await reservar(system, apiKey, reservaBody()).expect(201);
    expect(res.body).toEqual(expect.objectContaining({
      external_order_id: expect.stringMatching(/^ORD-[A-Z0-9]{10}$/),
      reservation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      reservation_code: expect.stringMatching(/^DEC-[A-Z0-9]{6}$/),
      status: 'CONFIRMED',
      date: tomorrow(),
      time: '10:30 a.m.',
      ticket_count: 3,
      adult_count: 2,
      child_count: 1,
      total_price: 75,
      currency: 'USD',
      guia_asignado: 'Lic. Carlos Morales (Credencial Mintur #5541)',
      punto_encuentro: 'Boulevard Naciones Unidas y Av. de los Shyris, frente al Banco del Pichincha',
      voucher_qr_payload: expect.stringMatching(/^ey/),
    }));
    expect(res.headers.location).toBe(`/api/v2/atracciones/reservas/${res.body.reservation_id}`);
    expect(res.body._links.cancel).toBe(`${res.headers.location}/cancel`);
    expect(await cuposDisponibles(system, 'PRhu4UBTWPBC', tomorrow(), '10:30')).toBe(antes - 3);

    const get = await http().get(res.headers.location).set('X-API-Key', apiKey).expect(200);
    expect(get.body).toEqual(res.body);
    // También por PNR y por /api/v1.
    await http().get(`/api/v1/atracciones/reservas/${res.body.reservation_code}`).set('X-API-Key', apiKey).expect(200);
  });

  it('la misma Idempotency-Key repite la respuesta sin descontar cupos ni duplicar el pago', async () => {
    const key = randomUUID();
    const first = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 }, tomorrow(), '14:00'), key).expect(201);
    const cupos = await cuposDisponibles(system, 'PRhu4UBTWPBC', tomorrow(), '14:00');
    const again = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 }, tomorrow(), '14:00'), key).expect(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers.location).toBe(first.headers.location);
    expect(await cuposDisponibles(system, 'PRhu4UBTWPBC', tomorrow(), '14:00')).toBe(cupos);
    const [{ n }] = await system.databases.payment!.query(`SELECT count(*)::int AS n FROM pago`);
    const [{ ordenes }] = await system.databases.order!.query(`SELECT count(*)::int AS ordenes FROM orden WHERE estado = 'CONFIRMADA'`);
    expect(n).toBe(ordenes);

    const otroCuerpo = await reservar(system, apiKey, reservaBody({ adult_count: 2, child_count: 0 }, tomorrow(), '14:00'), key).expect(409);
    expect(otroCuerpo.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('20 peticiones concurrentes por 5 cupos: exactamente 5 × 201 y 15 × 409 OUT_OF_STOCK', async () => {
    const fecha = tomorrow();
    await system.databases.inventory!.query(
      `UPDATE schema_atracciones.turnos_aforo SET cupos_totales = 5, cupos_reservados = 0 WHERE atraccion_codigo = 'QTOPANORAM10' AND fecha = $1 AND hora = '14:00'`,
      [fecha],
    );
    const body = reservaBody({ atraccion_id: 'QTOPANORAM10', adult_count: 1, child_count: 0 }, fecha, '14:00');
    const results = await Promise.all(Array.from({ length: 20 }, () => reservar(system, apiKey, body)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(15);
    const conflict = results.find((r) => r.status === 409)!;
    expect(conflict.body).toEqual(expect.objectContaining({ code: 'OUT_OF_STOCK', type: 'https://booking.epn.edu.ec/errors/sin-cupos', title: 'Cupos Agotados para el Turno Solicitado' }));
    expect(conflict.headers['content-type']).toMatch(/^application\/problem\+json/);
    const [turno] = await system.databases.inventory!.query(
      `SELECT cupos_reservados FROM schema_atracciones.turnos_aforo WHERE atraccion_codigo = 'QTOPANORAM10' AND fecha = $1 AND hora = '14:00'`,
      [fecha],
    );
    expect(turno.cupos_reservados).toBe(5);
  });

  it('un 409 OUT_OF_STOCK repetido con la misma clave es idéntico (mismo correlation_id y timestamp)', async () => {
    const key = randomUUID();
    const body = reservaBody({ atraccion_id: 'QTOPANORAM10', adult_count: 1, child_count: 0 }, tomorrow(), '14:00');
    const first = await reservar(system, apiKey, body, key).expect(409);
    const again = await reservar(system, apiKey, body, key).expect(409);
    expect(again.body).toEqual(first.body);
  });

  it('rechaza con 422 las reglas semánticas del contrato', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ customer: { ...reservaBody().customer, document_id: '1723456789' } }, 'INVALID_DOCUMENT'],
      [{ customer: { ...reservaBody().customer, phone: '12345' } }, 'INVALID_PHONE'],
      [{ customer: { ...reservaBody().customer, full_name: 'Paúl' } }, 'INVALID_NAME'],
      [{ slot_id: slot(tomorrow(), '11:00') }, 'SLOT_MISMATCH'],
      [{ hora: '10:00 a.m.' }, 'SLOT_MISMATCH'],
      [{ cantidad_adultos: 3 }, 'ALIAS_CONFLICT'],
      [{ idempotency_key: randomUUID() }, 'IDEMPOTENCY_KEY_MISMATCH'],
      [{ passengers: [{ full_name: 'Ana Rosero', ticket_type: 'SENIOR' }] }, 'PASSENGERS_MISMATCH'],
      [{ atraccion_id: 'NOEXISTE0000' }, 'ATTRACTION_NOT_FOUND'],
    ];
    for (const [overrides, code] of cases) {
      const res = await reservar(system, apiKey, reservaBody(overrides));
      expect({ code, status: res.status, got: res.body.code }).toEqual({ code, status: 422, got: code });
    }
    // Un turno que no existe (otra hora) también es SLOT_MISMATCH.
    const sinTurno = await reservar(system, apiKey, reservaBody({}, tomorrow(), '11:15')).expect(422);
    expect(sinTurno.body.code).toBe('SLOT_MISMATCH');
    // La hora en formato de 12 horas es válida si coincide con el slot.
    await reservar(system, apiKey, reservaBody({ hora: '10:30 a.m.', adult_count: 1, child_count: 0 })).expect(201);
  });

  it('un pago con tarjeta rechazado responde 422 PAYMENT_REJECTED y libera los cupos', async () => {
    await system.databases.inventory!.query(
      `UPDATE schema_atracciones.tarifa_precio SET precio = 45.51 WHERE tipo_boleto = 'ADULT' AND tarifa_id IN (SELECT id FROM schema_atracciones.tarifa WHERE atraccion_codigo = 'BNOSCASCAD08')`,
    );
    const antes = await cuposDisponibles(system, 'BNOSCASCAD08', tomorrow(), '09:00');
    const res = await reservar(system, apiKey, reservaBody({ atraccion_id: 'BNOSCASCAD08', adult_count: 1, child_count: 0, payment_method: 'TARJETA_CREDITO' }, tomorrow(), '09:00')).expect(422);
    expect(res.body.code).toBe('PAYMENT_REJECTED');
    expect(await cuposDisponibles(system, 'BNOSCASCAD08', tomorrow(), '09:00')).toBe(antes);
    const [orden] = await system.databases.order!.query(`SELECT estado, estado_saga FROM orden ORDER BY creado_en DESC LIMIT 1`);
    expect(orden).toEqual({ estado: 'FALLIDA', estado_saga: 'COMPENSADA' });
  });

  it('con Booking detenido en el paso 7: cupos y pago revertidos, 503, y el reintento con la misma clave funciona', async () => {
    const key = randomUUID();
    const body = reservaBody({ atraccion_id: 'MNDOBOSQUE07', adult_count: 2, child_count: 0 }, tomorrow(), '07:30');
    const antes = await cuposDisponibles(system, 'MNDOBOSQUE07', tomorrow(), '07:30');
    await system.stop('booking');
    const res = await reservar(system, apiKey, body, key).expect(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(await cuposDisponibles(system, 'MNDOBOSQUE07', tomorrow(), '07:30')).toBe(antes);
    const pagos = await system.databases.payment!.query(`SELECT estado FROM pago ORDER BY creado_en DESC LIMIT 1`);
    expect(pagos[0].estado).toBe('ANULADO');

    await system.restart('booking');
    await new Promise((resolve) => setTimeout(resolve, 600)); // el circuito del ESB vuelve a probar el servicio
    const retry = await reservar(system, apiKey, body, key).expect(201);
    expect(retry.body.status).toBe('CONFIRMED');
    expect(await cuposDisponibles(system, 'MNDOBOSQUE07', tomorrow(), '07:30')).toBe(antes - 2);
  });

  it('el worker de recuperación termina las compensaciones pendientes', async () => {
    // La compra con Booking caído dejó pendiente la cancelación (en duda) de su reserva.
    const [pendiente] = await system.databases.order!.query(`SELECT count(*)::int AS n FROM orden WHERE estado_saga = 'COMPENSANDO'`);
    expect(pendiente.n).toBeGreaterThan(0);
    expect(await system.order!.recoverStuckSagas()).toBe(pendiente.n);
    const abiertas = await system.databases.order!.query(`SELECT estado_saga FROM orden WHERE estado_saga NOT IN ('COMPLETADA', 'COMPENSADA')`);
    expect(abiertas).toEqual([]);
  });

  it('una falla de la pasarela de tarjetas (.52) responde 503 y compensa', async () => {
    await system.databases.inventory!.query(
      `UPDATE schema_atracciones.tarifa_precio SET precio = 45.52 WHERE tipo_boleto = 'ADULT' AND tarifa_id IN (SELECT id FROM schema_atracciones.tarifa WHERE atraccion_codigo = 'BNOSCASCAD08')`,
    );
    const antes = await cuposDisponibles(system, 'BNOSCASCAD08', tomorrow(), '14:00');
    await reservar(system, apiKey, reservaBody({ atraccion_id: 'BNOSCASCAD08', adult_count: 1, child_count: 0, payment_method: 'TARJETA_CREDITO' }, tomorrow(), '14:00')).expect(503);
    expect(await cuposDisponibles(system, 'BNOSCASCAD08', tomorrow(), '14:00')).toBe(antes);
  });

  it('GET /reservas/{id}: 403 para otro cliente, 404 si no existe; el usuario del portal ve las suyas', async () => {
    const reserva = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 })).expect(201);
    const otro = await userToken(system, 'cliente@portal.test', ['cliente']);
    await http().get(`/api/v2/atracciones/reservas/${reserva.body.reservation_id}`).set('Authorization', `Bearer ${otro}`).expect(403);
    await http().get(`/api/v2/atracciones/reservas/${randomUUID()}`).set('X-API-Key', apiKey).expect(404);
    await http().get(`/api/v2/atracciones/reservas/${reserva.body.reservation_id}`).expect(401);

    const propia = await http().post('/api/v2/atracciones/reservas').set('Authorization', `Bearer ${otro}`).set('Idempotency-Key', randomUUID())
      .send(reservaBody({ adult_count: 1, child_count: 0, payment_method: 'PAGO_EN_SITIO', customer: { ...reservaBody().customer, document_type: 'PASAPORTE', document_id: 'AB123456' } }))
      .expect(201);
    await http().get(`/api/v2/atracciones/reservas/${propia.body.reservation_code}`).set('Authorization', `Bearer ${otro}`).expect(200);
    expect(propia.body.customer).toEqual(expect.objectContaining({ document_id: 'AB123456', numero_documento: 'AB123456' }));
  });

  it('el titular con cédula válida se guarda y el voucher es determinista', async () => {
    const res = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 })).expect(201);
    const a = await http().get(`/api/v2/atracciones/reservas/${res.body.reservation_id}`).set('X-API-Key', apiKey).expect(200);
    expect(a.body.voucher_qr_payload).toBe(res.body.voucher_qr_payload);
    expect(a.body.customer.document_id).toBe(CEDULA);
  });
});
