import { randomUUID } from 'node:crypto';
import { EsbClient, runWithContext, signInternalPrincipal, type Principal } from '@atracciones/platform';
import request from 'supertest';
import { createGateway } from '../../apps/gateway/src';
import { sha256 } from '../../apps/services/ms-identity/src/application/tokens';
import { ApiClientRepository } from '../../apps/services/ms-identity/src/persistence/api-client-repository';
import { API_KEY, ATTRACTION, CUSTOMER, INACTIVE_API_KEY, seedV3, type SeedV3 } from '../fixtures/v3/seed';
import { SECRETS, startStack, type Stack } from '../support/stack';

/** 4.3 · Transporte: Gateway, Partner API, ESB y servicios reales con sus bases `ms_*`. */
describe('Transporte: Gateway, Partner API, ESB y servicios', () => {
  let stack: Stack;
  let seed: SeedV3;
  let esb: EsbClient;
  let socio: Principal;

  const gw = () => request(stack.gatewayUrl);
  const as = async <T>(principal: Principal, work: () => Promise<T>) =>
    runWithContext({ correlationId: `cid-${randomUUID()}`, principalToken: await signInternalPrincipal(principal, SECRETS.internal, 600) }, work);
  const reservation = (overrides: Record<string, unknown> = {}) => ({
    attraction_id: ATTRACTION, slot_id: seed.slots.holgado, date: seed.date, time: seed.times.holgado, adult_count: 1, customer: CUSTOMER, payment_method: { method: 'CREDIT_CARD' }, ...overrides,
  });

  beforeAll(async () => {
    stack = await startStack({ edge: true });
    seed = await seedV3(stack);
    esb = new EsbClient(stack.esbUrl, 20_000, SECRETS.service);
    socio = { tipo: 'API_CLIENTE', id: String(seed.partnerId), scopes: [], nombre: 'Booking' };
  }, 120_000);
  afterAll(async () => {
    await stack?.close();
  });

  // ---- Gateway ↔ ms-identity (T1) ----
  describe('Gateway ↔ ms-identity', () => {
    it('sin credencial en una operación protegida → 401 (sin pasar por ms-identity)', async () => {
      const res = await gw().get('/api/v3/atracciones/reservas/DEC-NOEXISTE');
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });
    it('JWT válido de un usuario con sesión activa → autenticado (la reserva inexistente da 404, no 401)', async () => {
      await gw().get('/api/v3/atracciones/reservas/DEC-NOEXISTE').set('Authorization', `Bearer ${seed.userJwt}`).expect(404);
    });
    it('X-API-Key válida → autenticado', async () => {
      await gw().get('/api/v3/atracciones/reservas/DEC-NOEXISTE').set('X-API-Key', API_KEY).expect(404);
    });
    it('X-API-Key inactiva → 401', async () => {
      const res = await gw().get('/api/v3/atracciones/reservas/DEC-NOEXISTE').set('X-API-Key', INACTIVE_API_KEY);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
    it('caché: una llave ya validada sigue valiendo sin volver a ms-identity (aunque se desactive durante el TTL)', async () => {
      const key = 'clave-cache-de-pruebas';
      const clients = new ApiClientRepository(stack.db['ms-identity']!.dataSource);
      const created = await clients.create('SOCIO-CACHE', 'Cache', sha256(key));
      await gw().get('/api/v3/atracciones/reservas/DEC-NOEXISTE').set('X-API-Key', key).expect(404);
      await clients.setActive(created.id, false);
      await gw().get('/api/v3/atracciones/reservas/DEC-NOEXISTE').set('X-API-Key', key).expect(404);
    });
  });

  // ---- Gateway ↔ Partner API ----
  describe('Gateway ↔ Partner API', () => {
    it('proxy de /api/v3: el árbol de categorías llega desde ms-catalog', async () => {
      const res = await gw().get('/api/v3/atracciones/categorias/arbol').expect(200);
      expect(res.body.map((c: { id: string }) => c.id)).toContain('cat-aventura-100');
    });
    it('X-Correlation-Id de ida y vuelta', async () => {
      await gw().get('/api/v3/atracciones/categorias').set('X-Correlation-Id', 'booking-cid-77').expect('X-Correlation-Id', 'booking-cid-77');
    });
    it('el principal interno firmado por el Gateway llega a ms-booking (el feed exige un socio)', async () => {
      await gw().get('/api/v3/atracciones/eventos').set('X-API-Key', API_KEY).expect(200);
    });
    it('Partner API que no responde → 503 ProblemDetails', async () => {
      const gateway = await createGateway({ port: 0, upstreams: { partnerApi: 'http://127.0.0.1:9', identity: 'http://127.0.0.1:9', esb: stack.esbUrl, graphql: null }, internalTokenSecret: SECRETS.internal, corsOrigins: [], rateLimitPerMinute: 1000, apiKeyCacheMs: 1, tokenCacheMs: 1 });
      await gateway.init();
      try {
        const res = await request(gateway.getHttpServer()).get('/api/v3/atracciones/categorias');
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
      } finally {
        await gateway.close();
      }
    });
  });

  // ---- Partner API ↔ ESB ↔ servicios ----
  describe('Partner API ↔ ESB ↔ servicios (respuestas validadas contra el contrato v3)', () => {
    it('catalog: ficha completa de ms-catalog', async () => {
      const res = await gw().get(`/api/v3/atracciones/${ATTRACTION}`).expect(200);
      expect(res.body).toMatchObject({ id: ATTRACTION, price: { adult: 45 } });
    });
    it('catalog: atracción inexistente → 404 ProblemDetails del servicio', async () => {
      const res = await gw().get('/api/v3/atracciones/NOEXISTE1234');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ status: 404, code: 'ATTRACTION_NOT_FOUND' });
    });
    it('reservations: 201 con Location y external_order_id', async () => {
      const res = await gw().post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID()).send(reservation());
      expect(res.status).toBe(201);
      expect(res.headers.location).toMatch(/\/api\/v3\/atracciones\/reservas\//);
      expect(res.body.external_order_id).toBeTruthy();
    });
    it('reservations: slot_id que no coincide con la hora → 400 SLOT_TIME_MISMATCH', async () => {
      const res = await gw().post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID()).send(reservation({ time: '11:00:00' }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SLOT_TIME_MISMATCH');
    });
    it('reservations: titular con documento inválido → 422', async () => {
      const res = await gw().post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID()).send(reservation({ customer: { ...CUSTOMER, document_id: '1710034064' } }));
      expect(res.status).toBe(422);
      expect(res.body.invalid_params).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'customer.document_id' })]));
    });
    it('events: feed del outbox de ms-booking', async () => {
      const res = await gw().get('/api/v3/atracciones/eventos?type=RESERVA_CREADA').set('X-API-Key', API_KEY).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((e: { event_type: string }) => e.event_type === 'RESERVA_CREADA')).toBe(true);
    });
    it('health: salud agregada del nodo con los servicios reales', async () => {
      const res = await gw().get('/api/v3/atracciones/health');
      expect([200, 503]).toContain(res.status);
      expect(res.body).toMatchObject({ node_id: expect.any(String), database_connected: true });
    });
    it('correlación en todo el tramo: el X-Correlation-Id de Booking queda en el evento del outbox', async () => {
      const cid = `cid-tramo-${randomUUID().slice(0, 8)}`;
      const res = await gw().post('/api/v3/atracciones/reservas').set('X-API-Key', API_KEY).set('Idempotency-Key', randomUUID()).set('X-Correlation-Id', cid).send(reservation());
      expect(res.status).toBe(201);
      const [event] = await stack.db['ms-booking']!.dataSource.query(`SELECT evt_correlation_id FROM outbox_evento WHERE evt_aggregate_id = $1 LIMIT 1`, [res.body.reservation_code]);
      expect(event.evt_correlation_id).toBe(cid);
    });
  });

  // ---- ESB ↔ servicios REST: una operación por servicio (cableado real) ----
  describe('ESB ↔ servicios REST', () => {
    it('ms-catalog · getCategoryTree', async () => {
      await expect(esb.call<unknown[]>('catalog', 'getCategoryTree')).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'cat-aventura-100' })]));
    });
    it('ms-coupon · getAgreement', async () => {
      await expect(as(socio, () => esb.call('coupon', 'getAgreement'))).resolves.toMatchObject({ permite_promociones: expect.any(Boolean) });
    });
    it('ms-identity · validateApiKey', async () => {
      await expect(esb.call('identity', 'validateApiKey', { api_key: API_KEY })).resolves.toMatchObject({ tipo: 'CLIENTE_API', id: seed.partnerId });
    });
    it('ms-location · listCities', async () => {
      await expect(esb.call<{ nombre: string }[]>('location', 'listCities', { q: 'quito' })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ nombre: 'Quito' })]));
    });
    it('ms-payment · listMethods', async () => {
      await expect(esb.call<{ codigo: string }[]>('payment', 'listMethods')).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ codigo: 'CREDIT_CARD' })]));
    });
    it('ms-refund · listRefunds', async () => {
      await expect(as({ tipo: 'USUARIO', id: '1', scopes: ['ADMIN'] }, () => esb.call('refund', 'listRefunds'))).resolves.toBeDefined();
    });
    it('ms-billing-profile · ensurePrincipalForClient', async () => {
      await expect(esb.call('billing', 'ensurePrincipalForClient', { claId: 501, tipo_identificacion: 'CEDULA', identificacion: '1710034065', razon_social: 'Ana Pérez', correo: 'ana@correo.com', telefono: null })).resolves.toMatchObject({ es_principal: true });
    });
    it('ms-review · listReviews (resuelve la atracción en ms-catalog)', async () => {
      await expect(esb.call('review', 'listReviews', { id: ATTRACTION })).resolves.toMatchObject({ data: [] });
    });
  });

  // ---- ESB ↔ servicios RPC (POST /internal/rpc/<Método> con los mensajes del .proto) ----
  describe('ESB ↔ servicios RPC', () => {
    it('ms-inventory · GetAvailability', async () => {
      await expect(esb.call('inventory', 'getAvailability', { id: ATTRACTION, date: seed.date })).resolves.toMatchObject({ atraccion_id: ATTRACTION, time_slots: expect.any(Array) });
    });
    it('ms-pricing · QuoteTickets', async () => {
      await expect(esb.call('pricing', 'quoteTickets', { attraction_id: ATTRACTION, date: seed.date, boletos: [{ ticket_type: 'CHILD', cantidad: 2 }] })).resolves.toMatchObject({ total: 45 });
    });
    it('ms-order · ListOrders del socio', async () => {
      await expect(as(socio, () => esb.call('order', 'listOrders', { page: 1, limit: 5 }))).resolves.toMatchObject({ total_results: expect.any(Number) });
    });
    it('ms-booking · ListEvents', async () => {
      await expect(as(socio, () => esb.call('booking', 'listEvents', { after: 0, limit: 5 }))).resolves.toMatchObject({ events: expect.any(Array) });
    });
  });
});
