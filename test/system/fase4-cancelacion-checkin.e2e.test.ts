import { randomUUID } from 'node:crypto';
import { addDays, todayIn } from '@atracciones/platform';
import request from 'supertest';
import { CEDULA, cuposDisponibles, reservar, reservaBody, tomorrow } from './booking-flow';
import { startSystem, userToken, type System } from './harness';

/** Fase 4 (plan §8): cancelación (compensación de la saga de Booking) y check-in presencial. */
describe('Fase 4 — Cancelación y check-in', () => {
  let system: System;
  let apiKey: string;
  const http = () => request(system.gatewayUrl);
  const cancelar = (id: string, body: object | undefined, key = randomUUID(), auth: [string, string] = ['X-API-Key', apiKey]) => {
    const req = http().post(`/api/v2/atracciones/reservas/${id}/cancel`).set(auth[0], auth[1]).set('Idempotency-Key', key);
    return body === undefined ? req : req.send(body);
  };
  const checkin = (id: string, body: object, key = randomUUID(), auth: [string, string] = ['X-API-Key', apiKey]) =>
    http().post(`/api/v2/atracciones/reservas/${id}/checkin`).set(auth[0], auth[1]).set('Idempotency-Key', key).send(body);

  /** Turno de hoy a última hora, para poder hacer check-in el día de la actividad. */
  const HOY = () => todayIn('America/Guayaquil');
  beforeAll(async () => {
    system = await startSystem({ sagas: true });
    apiKey = (await system.identity.accounts.createApiKey({ nombre: 'booking-prototipo', email: 'integracion@booking.test' })).apiKey;
    await system.databases.inventory!.query(
      `INSERT INTO schema_atracciones.turnos_aforo (atraccion_codigo, fecha, hora, cupos_totales, guia_id)
       SELECT 'PRhu4UBTWPBC', $1::date, '23:59', 25, id FROM schema_atracciones.guia WHERE codigo = 'GUIA-CARLOS-01'
       ON CONFLICT DO NOTHING`,
      [HOY()],
    );
  });
  afterAll(async () => {
    await system?.close();
  });

  it('la compensación de Booking (SAGA_ORCHESTRATOR) es idempotente: dos cancelaciones → 200 y los cupos se liberan una vez', async () => {
    const antes = await cuposDisponibles(system, 'PRhu4UBTWPBC', tomorrow(), '10:30');
    const reserva = await reservar(system, apiKey, reservaBody()).expect(201);
    expect(await cuposDisponibles(system, 'PRhu4UBTWPBC', tomorrow(), '10:30')).toBe(antes - 3);

    const body = { reason: 'SAGA_COMPENSATION_PARTNER_FAILURE', solicitante: 'SAGA_ORCHESTRATOR' };
    const first = await cancelar(reserva.body.reservation_id, body).expect(200);
    expect(first.body).toEqual(expect.objectContaining({
      status: 'CANCELLED', estado: 'CANCELLED', reservation_id: reserva.body.reservation_id,
      reembolso_id: expect.stringMatching(/^REF-ATR-/), monto_reembolsado: 75,
    }));
    const second = await cancelar(reserva.body.reservation_code, body).expect(200);
    expect(second.body.status).toBe('CANCELLED');
    expect(second.body.reembolso_id).toBe(first.body.reembolso_id);
    expect(await cuposDisponibles(system, 'PRhu4UBTWPBC', tomorrow(), '10:30')).toBe(antes);

    // Misma clave → misma respuesta.
    const key = randomUUID();
    const a = await cancelar(reserva.body.reservation_id, body, key).expect(200);
    const b = await cancelar(reserva.body.reservation_id, body, key).expect(200);
    expect(b.body).toEqual(a.body);
    const [{ n }] = await system.databases.payment!.query(`SELECT count(*)::int AS n FROM reembolso`);
    expect(n).toBe(1);
  });

  it('sin cuerpo, el cliente cancela dentro del plazo gratuito; fuera de él, 409', async () => {
    // A tres días: el plazo gratuito (24 h antes) sigue vigente.
    const reserva = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 }, addDays(HOY(), 3))).expect(201);
    const cancelada = await cancelar(reserva.body.reservation_id, undefined).expect(200);
    expect(cancelada.body.status).toBe('CANCELLED');

    // La Basílica no tiene cancelación gratuita.
    const basilica = await reservar(system, apiKey, reservaBody({ atraccion_id: 'QTOBASILIC06', adult_count: 1, child_count: 0 }, tomorrow(), '09:00')).expect(201);
    const fuera = await cancelar(basilica.body.reservation_id, { reason: 'Cambio de planes' }).expect(409);
    expect(fuera.body.code).toBe('CANCELLATION_DEADLINE_PASSED');
    // La compensación de la saga no está sujeta al plazo.
    await cancelar(basilica.body.reservation_id, { solicitante: 'SAGA_ORCHESTRATOR' }).expect(200);
  });

  it('cancelar exige permisos: un usuario no puede actuar como SAGA_ORCHESTRATOR ni cancelar reservas ajenas', async () => {
    const reserva = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 })).expect(201);
    const cliente = await userToken(system, 'cliente@portal.test', ['cliente']);
    await cancelar(reserva.body.reservation_id, { solicitante: 'SAGA_ORCHESTRATOR' }, randomUUID(), ['Authorization', `Bearer ${cliente}`]).expect(403);
    await cancelar(reserva.body.reservation_id, {}, randomUUID(), ['Authorization', `Bearer ${cliente}`]).expect(403);
    await cancelar(randomUUID(), {}).expect(404);
    await http().post(`/api/v2/atracciones/reservas/${reserva.body.reservation_id}/cancel`).set('X-API-Key', apiKey).send({}).expect(400);
  });

  it('check-in: documento ajeno → 403; misma clave → 200 idéntico; otra clave → 409', async () => {
    const reserva = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 }, HOY(), '23:59')).expect(201);
    const ajeno = await checkin(reserva.body.reservation_id, { documento_identidad: '0102030405' }).expect(403);
    expect(ajeno.body.code).toBe('IDENTITY_MISMATCH');
    const voucherMalo = await checkin(reserva.body.reservation_id, { documento_identidad: CEDULA, codigo_voucher_qr: 'DEC-NOEXIS' }).expect(400);
    expect(voucherMalo.body.code).toBe('INVALID_VOUCHER');

    const key = randomUUID();
    const body = { documento_identidad: CEDULA, codigo_voucher_qr: reserva.body.voucher_qr_payload, guia_codigo: 'GUIA-CARLOS-01', scanner_device_id: 'SCANNER-TERMINAL-04' };
    const first = await checkin(reserva.body.reservation_id, body, key).expect(200);
    expect(first.body).toEqual(expect.objectContaining({
      reserva_id: reserva.body.reservation_id, reservation_code: reserva.body.reservation_code, estado: 'CHECKED_IN',
      titular_nombre: 'Paúl Rosero', titular_documento: CEDULA, guia_asignado: 'Lic. Carlos Morales (Credencial Mintur #5541)',
      hora_checkin: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    }));
    const again = await checkin(reserva.body.reservation_id, body, key).expect(200);
    expect(again.body).toEqual(first.body);
    const other = await checkin(reserva.body.reservation_id, body).expect(409);
    expect(other.body.code).toBe('ALREADY_CHECKED_IN');

    const estado = await http().get(`/api/v2/atracciones/reservas/${reserva.body.reservation_id}`).set('X-API-Key', apiKey).expect(200);
    expect(estado.body.status).toBe('CHECKED_IN');
    // Una reserva con check-in ya no se cancela.
    expect((await cancelar(reserva.body.reservation_id, { solicitante: 'SAGA_ORCHESTRATOR' }).expect(409)).body.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('check-in fuera del día de la actividad o de una reserva cancelada → 409', async () => {
    const futura = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 })).expect(201);
    expect((await checkin(futura.body.reservation_id, { documento_identidad: CEDULA }).expect(409)).body.code).toBe('CHECKIN_OUT_OF_WINDOW');

    const cancelada = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 }, HOY(), '23:59')).expect(201);
    await cancelar(cancelada.body.reservation_id, { solicitante: 'SAGA_ORCHESTRATOR' }).expect(200);
    expect((await checkin(cancelada.body.reservation_id, { documento_identidad: CEDULA }).expect(409)).body.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('un guía (rol guia) hace el check-in de una reserva de Booking con el documento de un pasajero', async () => {
    const reserva = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 1, passengers: [{ full_name: 'Mateo Rosero', document_id: '1754321098', ticket_type: 'CHILD' }] }, HOY(), '23:59')).expect(201);
    const guia = await userToken(system, 'carlos.morales@tourgirls.test', ['guia']);
    const cliente = await userToken(system, 'otro@portal.test', ['cliente']);
    await checkin(reserva.body.reservation_id, { documento_identidad: '1754321098' }, randomUUID(), ['Authorization', `Bearer ${cliente}`]).expect(403);
    const res = await checkin(reserva.body.reservation_id, { documento_identidad: '1754321098', guia_codigo: 'GUIA-CARLOS-01' }, randomUUID(), ['Authorization', `Bearer ${guia}`]).expect(200);
    expect(res.body.estado).toBe('CHECKED_IN');
  });
});
