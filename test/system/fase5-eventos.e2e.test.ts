import { callUnary, insecureClient, loadProto, serviceConstructor } from '@atracciones/platform';
import request from 'supertest';
import { cuposDisponibles, reservar, reservaBody, tomorrow } from './booking-flow';
import { startSystem, type System } from './harness';

/** Fase 5 (plan §8): eventos, outbox, feed de integración y sincronización gRPC del stock con Booking. */
describe('Fase 5 — Eventos, feed y sincronización con Booking', () => {
  let system: System;
  let apiKey: string;
  const http = () => request(system.gatewayUrl);
  const feed = (query: Record<string, unknown> = {}) => http().get('/api/v2/atracciones/eventos').set('X-API-Key', apiKey).query(query);

  beforeAll(async () => {
    system = await startSystem({ events: true });
    apiKey = (await system.identity.accounts.createApiKey({ nombre: 'booking-prototipo', email: 'integracion@booking.test' })).apiKey;
  });
  afterAll(async () => {
    await system?.close();
  });

  it('la carga inicial de turnos llega a Booking por StreamInventoryChanges', async () => {
    await system.pumpEvents();
    const streamed = system.bookingMock!.received.streamed;
    expect(streamed.length).toBeGreaterThan(100);
    expect(streamed[0]).toEqual(expect.objectContaining({ service_id: 'atracciones-dilan', delta: expect.any(Number), time_slot: expect.stringMatching(/^\d{2}:\d{2} [ap]\.m\.$/) }));
  });

  it('una compra publica RESERVA_CREADA, RESERVA_CONFIRMADA y STOCK_ACTUALIZADO con el correlation_id de la petición', async () => {
    const res = await reservar(system, apiKey, reservaBody()).set('X-Correlation-Id', 'cid-compra-fase5').expect(201);
    await system.pumpEvents();

    const eventos = (await feed({ limit: 200 }).expect(200)).body as { event_type: string; aggregate_id: string; correlation_id: string; sequence_number: number; specversion: string; payload: object; data: object }[];
    const propios = eventos.filter((e) => e.correlation_id === 'cid-compra-fase5');
    const tipos = propios.map((e) => e.event_type);
    expect(tipos).toEqual(expect.arrayContaining(['RESERVA_CREADA', 'RESERVA_CONFIRMADA', 'STOCK_ACTUALIZADO']));
    const creada = propios.find((e) => e.event_type === 'RESERVA_CREADA')!;
    const confirmada = propios.find((e) => e.event_type === 'RESERVA_CONFIRMADA')!;
    expect(creada.sequence_number).toBeLessThan(confirmada.sequence_number);
    expect(creada.aggregate_id).toBe(res.body.reservation_code);
    expect(propios.find((e) => e.event_type === 'STOCK_ACTUALIZADO')!.aggregate_id).toBe('PRhu4UBTWPBC');
    expect(creada).toEqual(expect.objectContaining({ specversion: '1.0', source: '/api/v2/atracciones' }));
    expect(creada.data).toEqual(creada.payload);
    // Sin datos personales del titular en el feed.
    expect(JSON.stringify(propios)).not.toContain('Paúl Rosero');
    expect(JSON.stringify(propios)).not.toContain('1710034065');
  });

  it('Booking recibe PushStockUpdate con los cupos disponibles reales del turno', async () => {
    const fecha = tomorrow();
    await reservar(system, apiKey, reservaBody({ adult_count: 2, child_count: 0 }, fecha, '14:00')).expect(201);
    await system.pumpEvents();
    const disponibles = await cuposDisponibles(system, 'PRhu4UBTWPBC', fecha, '14:00');
    const ultimo = system.bookingMock!.received.pushes.filter((p) => p.date === fecha && p.time_slot === '02:00 p.m.').at(-1);
    expect(ultimo).toEqual(expect.objectContaining({ service_id: 'atracciones-dilan', item_id: 'PRhu4UBTWPBC', available_units: disponibles, timestamp: expect.any(Number) }));
  });

  it('con Booking caído la venta funciona igual y el envío se completa al volver', async () => {
    system.bookingMock!.setDown(true);
    const fecha = tomorrow();
    await reservar(system, apiKey, reservaBody({ atraccion_id: 'QTOPANORAM10', adult_count: 1, child_count: 0 }, fecha, '14:00')).expect(201);
    await system.pumpEvents();
    const [pendiente] = await system.databases.inventory!.query(`SELECT estado, intentos FROM schema_atracciones.sincronizacion_booking WHERE metodo = 'PUSH' ORDER BY generado_en DESC LIMIT 1`);
    expect(pendiente).toEqual({ estado: 'ERROR', intentos: 1 });

    system.bookingMock!.setDown(false);
    // Espera de reintento: 2^intentos segundos.
    await system.databases.inventory!.query(`UPDATE schema_atracciones.sincronizacion_booking SET procesado_en = now() - interval '1 minute' WHERE estado = 'ERROR'`);
    await system.pumpEvents();
    const recibido = system.bookingMock!.received.pushes.filter((p) => p.item_id === 'QTOPANORAM10').at(-1);
    expect(recibido).toEqual(expect.objectContaining({ date: fecha, available_units: await cuposDisponibles(system, 'QTOPANORAM10', fecha, '14:00') }));
    const [{ n }] = await system.databases.inventory!.query(`SELECT count(*)::int AS n FROM schema_atracciones.sincronizacion_booking WHERE estado <> 'ENVIADO'`);
    expect(n).toBe(0);
  });

  it('una cancelación publica RESERVA_CANCELADA y el feed filtra por tipo y pagina por cursor', async () => {
    const reserva = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 })).expect(201);
    await http().post(`/api/v2/atracciones/reservas/${reserva.body.reservation_id}/cancel`).set('X-API-Key', apiKey).set('Idempotency-Key', crypto.randomUUID())
      .send({ solicitante: 'SAGA_ORCHESTRATOR' }).expect(200);
    await system.pumpEvents();

    const canceladas = (await feed({ type: 'RESERVA_CANCELADA' }).expect(200)).body;
    expect(canceladas.map((e: { aggregate_id: string }) => e.aggregate_id)).toContain(reserva.body.reservation_code);
    expect(canceladas.every((e: { event_type: string }) => e.event_type === 'RESERVA_CANCELADA')).toBe(true);

    const primeros = (await feed({ limit: 2 }).expect(200)).body;
    expect(primeros).toHaveLength(2);
    const siguientes = (await feed({ after: primeros[1].sequence_number, limit: 2 }).expect(200)).body;
    expect(siguientes[0].sequence_number).toBeGreaterThan(primeros[1].sequence_number);
    // /eventos no documenta 400: un limit mayor que 200 se acota al máximo del contrato.
    const todos = (await feed({ limit: 500 }).expect(200)).body;
    expect(todos.length).toBeLessThanOrEqual(200);
    await http().get('/api/v2/atracciones/eventos').expect(401);
  });

  it('Audit guarda todos los eventos en la bitácora y Catalog proyecta la popularidad, sin mensajes muertos', async () => {
    const tipos = (await system.databases.audit!.query(`SELECT DISTINCT tipo_evento FROM bitacora ORDER BY 1`)).map((r: { tipo_evento: string }) => r.tipo_evento);
    expect(tipos).toEqual(expect.arrayContaining(['CupoBloqueado', 'DisponibilidadActualizada', 'OrdenCreada', 'OrdenConfirmada', 'PagoAprobado', 'ReservaEmitida', 'ReservaCancelada', 'ReembolsoEmitido', 'CupoLiberado', 'OrdenCancelada']));
    const [{ popularidad }] = await system.databases.catalog!.query(`SELECT popularidad FROM atraccion WHERE codigo_publico = 'PRhu4UBTWPBC'`);
    expect(popularidad).toBe(800 + 3); // inicial (8 reseñas × 100) + 3 reservas emitidas
    expect(system.bus.deadLetters).toEqual([]);
  });

  it('Inventory recibe recargas de aforo por su propio InventoryStockService (proto oficial)', async () => {
    const fecha = tomorrow();
    const client = insecureClient(serviceConstructor(loadProto('booking/inventory.proto'), 'inventory.InventoryStockService'), `127.0.0.1:${system.inventoryGrpcPort}`);
    try {
      const ack = await callUnary<object, { success: boolean }>(client, 'PushStockUpdate', {
        service_id: 'booking-prototipo', item_id: 'CHMBRZSOL009', date: fecha, time_slot: '06:00 a.m.', available_units: 4, timestamp: Date.now(),
      });
      expect(ack.success).toBe(true);
      expect(await cuposDisponibles(system, 'CHMBRZSOL009', fecha, '06:00')).toBe(4);
    } finally {
      client.close();
    }
  });
});
