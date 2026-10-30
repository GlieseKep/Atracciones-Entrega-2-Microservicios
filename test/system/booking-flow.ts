import { randomUUID } from 'node:crypto';
import { addDays, todayIn } from '@atracciones/platform';
import request from 'supertest';
import type { System } from './harness';

/** Cédula ecuatoriana válida (módulo 10) para las pruebas. */
export const CEDULA = '1710034065';
export const tomorrow = () => addDays(todayIn('America/Guayaquil'), 1);
export const slot = (fecha: string, hora: string) => `slot-${fecha.replace(/-/g, '')}-${hora.replace(':', '').slice(0, 4)}`;

/** Cuerpo de `POST /atracciones/reservas` como lo enviaría Booking Prototipo. */
export function reservaBody(overrides: Record<string, unknown> = {}, fecha = tomorrow(), hora = '10:30') {
  return {
    atraccion_id: 'PRhu4UBTWPBC',
    fecha,
    slot_id: slot(fecha, hora),
    hora: `${hora}:00`,
    adult_count: 2,
    child_count: 1,
    customer: { full_name: 'Paúl Rosero', email: 'paul.rosero@epn.edu.ec', phone: '+593991234567', document_type: 'CEDULA', document_id: CEDULA },
    payment_method: 'SOA_BOOKING_GATEWAY',
    saga_id: 'SAGA-7K2X9M',
    ...overrides,
  };
}

export function reservar(system: System, apiKey: string, body: object, key = randomUUID()) {
  return request(system.gatewayUrl).post('/api/v2/atracciones/reservas').set('X-API-Key', apiKey).set('Idempotency-Key', key).send(body);
}

/** Cupos disponibles de un turno según el contrato (`GET /disponibilidad`). */
export async function cuposDisponibles(system: System, atraccion: string, fecha: string, hora: string): Promise<number> {
  const res = await request(system.gatewayUrl).get(`/api/v2/atracciones/${atraccion}/disponibilidad`).query({ date: fecha }).expect(200);
  const turno = res.body.time_slots.find((s: { time_24h: string }) => s.time_24h === `${hora}:00`);
  return turno.cupos_disponibles;
}
