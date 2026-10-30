import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { startSystem, type System } from './harness';

/** Fase 1 (plan §8): Gateway, Partner API, ESB e Identity. */
describe('Fase 1 — Gateway, Partner API, ESB e Identity', () => {
  let system: System;
  let apiKey: string;
  const http = () => request(system.gatewayUrl);

  beforeAll(async () => {
    system = await startSystem({ rateLimitPerMinute: 3 });
    apiKey = (await system.identity.accounts.createApiKey({ nombre: 'booking-prototipo', email: 'integracion@booking.test' })).apiKey;
  });
  afterAll(async () => {
    await system?.close();
  });

  it.each(['/api/v2', '/api/v1'])('sin credenciales, %s/atracciones/reservas responde 401 problem+json con correlation_id', async (base) => {
    const res = await http().post(`${base}/atracciones/reservas`).set('Idempotency-Key', randomUUID()).send({}).expect(401);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual(expect.objectContaining({ status: 401, code: 'UNAUTHORIZED', type: 'https://booking.epn.edu.ec/errors/unauthorized' }));
    expect(res.body.correlation_id).toBe(res.headers['x-correlation-id']);
    expect(res.body.correlation_id).toMatch(/^cid-/);
  });

  it('propaga el X-Correlation-Id recibido hasta la Partner API y lo devuelve', async () => {
    const res = await http().post('/api/v2/atracciones/reservas').set('X-Correlation-Id', 'cid-8821a-9923').send({}).expect(401);
    expect(res.headers['x-correlation-id']).toBe('cid-8821a-9923');
    expect(res.body.correlation_id).toBe('cid-8821a-9923');
  });

  it('con una X-API-Key válida la petición pasa al siguiente tramo (validación del contrato)', async () => {
    const sinClave = await http().post('/api/v2/atracciones/reservas').set('X-API-Key', apiKey).send({}).expect(400);
    expect(sinClave.body.code).toBe('MISSING_IDEMPOTENCY_KEY');

    const cuerpoInvalido = await http().post('/api/v1/atracciones/reservas').set('X-API-Key', apiKey).set('Idempotency-Key', randomUUID()).send({ atraccion_id: 'PRhu4UBTWPBC' }).expect(400);
    expect(cuerpoInvalido.body.code).toBe('VALIDATION_ERROR');
    expect(cuerpoInvalido.body.invalid_params).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'fecha', reason: 'Es obligatorio.' })]));
  });

  it('rechaza claves de API y tokens inválidos, y un principal interno falsificado', async () => {
    await http().get('/api/v2/atracciones/eventos').set('X-API-Key', 'atr_AAAAAAAAAAAA_invalida').expect(401);
    await http().get('/api/v2/atracciones/eventos').set('Authorization', 'Bearer no.es.un.jwt').expect(401);
    await http().get('/api/v2/atracciones/eventos').set('X-Internal-Principal', 'falsificado').expect(401);
  });

  it('un usuario registrado obtiene un JWT RS256 que el Gateway acepta', async () => {
    await http().post('/auth/register').send({ email: 'paul.rosero@epn.edu.ec', password: 'clave-segura-1', nombre_completo: 'Paúl Rosero' }).expect(201);
    const login = await http().post('/auth/login').send({ email: 'Paul.Rosero@epn.edu.ec', password: 'clave-segura-1' }).expect(200);
    expect(login.body.scope).toBe('attractions:book attractions:cancel attractions:read');
    const jwks = await http().get('/.well-known/jwks.json').expect(200);
    expect(jwks.body.keys[0]).toEqual(expect.objectContaining({ kty: 'RSA', alg: 'RS256', use: 'sig' }));

    // Autenticado: ya no es 401; la operación todavía no existe en esta fase.
    const res = await http().get(`/api/v2/atracciones/reservas/${randomUUID()}`).set('Authorization', `Bearer ${login.body.access_token}`);
    expect(res.status).not.toBe(401);
  });

  it('ninguna ruta antigua del monolito responde bajo /api/v1', async () => {
    for (const path of ['/api/v1/orders', '/api/v1/payments/simulations', '/api/v1/users/me']) {
      const res = await http().get(path).expect(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    }
    await http().post('/api/v1/atracciones/PRhu4UBTWPBC/reservations').send({}).expect(404);
  });

  it('el límite de tasa nunca responde 429 en las rutas del contrato', async () => {
    for (let i = 0; i < 6; i++) await http().get('/api/v2/atracciones/eventos').expect(401);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await http().post('/auth/login').send({ email: 'x@example.com', password: 'xxxxxxxx' })).status);
    expect(statuses).toContain(429);
  });

  it('GET /atracciones/health responde el NodeHealthResponse del contrato', async () => {
    const res = await http().get('/api/v2/atracciones/health').expect(200);
    expect(res.body).toEqual(expect.objectContaining({ version: '2.0.0', node_code: 'TOURGIRLS_ATRACCIONES', database_connected: true }));
    // DEGRADED si el proceso de pruebas (todos los componentes juntos) supera el umbral de memoria.
    expect(['UP', 'DEGRADED']).toContain(res.body.status);
  });
});
