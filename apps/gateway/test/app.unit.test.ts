import type { INestApplication } from '@nestjs/common';
import { verifyInternalPrincipal } from '@atracciones/platform';
import request from 'supertest';
import { FakeHttpServer } from '../../../test/support/fake-http';
import { createGateway } from '../src/app';
import type { GatewayConfig } from '../src/config';

const SECRET = 'secreto-interno-de-pruebas-con-mas-de-32-caracteres';

/**
 * Gateway real con sus dependencias reemplazadas por dobles HTTP: la Partner API, Identity y el ESB (que valida
 * credenciales). Así se prueba `isContractPath` y el manejo de cabeceras a través de lo que el módulo exporta.
 */
describe('gateway/app · rutas del contrato y cabeceras (T1, T2)', () => {
  const partnerApi = new FakeHttpServer();
  const identity = new FakeHttpServer();
  const esb = new FakeHttpServer();
  let app: INestApplication;

  beforeAll(async () => {
    process.env.LOG_SILENT = 'true';
    await Promise.all([partnerApi.start(), identity.start(), esb.start()]);
    const echo = (r: { path: string; headers: Record<string, unknown> }) => ({ body: { path: r.path, principal: r.headers['x-internal-principal'] ?? null, correlation: r.headers['x-correlation-id'] } });
    for (const path of ['/api/v3/atracciones', '/api/v3/atracciones/categorias', '/api/v3']) partnerApi.on('GET', path, echo);
    identity.on('POST', '/api/v3/auth/login', echo);
    esb.on('POST', '/esb/identity/validateApiKey', { body: { tipo: 'CLIENTE_API', id: 9, nombre: 'Booking', roles: [] } });
    const config: GatewayConfig = {
      port: 0,
      upstreams: { partnerApi: partnerApi.url, identity: identity.url, esb: esb.url, graphql: null },
      internalTokenSecret: SECRET,
      corsOrigins: [],
      rateLimitPerMinute: 1000,
      apiKeyCacheMs: 60_000,
      tokenCacheMs: 30_000,
    };
    app = await createGateway(config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([partnerApi.stop(), identity.stop(), esb.stop()]);
  });

  beforeEach(() => {
    partnerApi.requests.length = 0;
    identity.requests.length = 0;
  });

  it('isContractPath · /api/v3/atracciones/* va a la Partner API autenticado', async () => {
    const res = await request(app.getHttpServer()).get('/api/v3/atracciones/categorias').set('X-API-Key', 'clave');
    expect(res.status).toBe(200);
    expect(res.body.path).toBe('/api/v3/atracciones/categorias');
    await expect(verifyInternalPrincipal(res.body.principal, SECRET)).resolves.toMatchObject({ tipo: 'API_CLIENTE', id: '9' });
  });

  it('isContractPath · /api/v3/auth/* no es del contrato: va a Identity sin principal', async () => {
    const res = await request(app.getHttpServer()).post('/api/v3/auth/login').send({});
    expect(res.status).toBe(200);
    expect(identity.calls('POST', '/api/v3/auth/login')).toHaveLength(1);
    expect(partnerApi.requests).toHaveLength(0);
  });

  it('isContractPath · /api/v2 y /api/v1 no se enrutan a la Partner API → 404 ProblemDetails', async () => {
    for (const path of ['/api/v2/atracciones', '/api/v1/atracciones']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
    expect(partnerApi.requests).toHaveLength(0);
  });

  it('isContractPath · ruta fuera del contrato → 404 con code NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/otra/ruta');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  // DEFECTO-01 (Calidad/DEFECTOS_ENCONTRADOS.md): una petición anónima conserva el x-internal-principal del cliente,
  // porque requestContext lo copia al contexto antes de que authentication borre la cabecera. `it.failing` mantiene el
  // caso visible: cuando se corrija el código, Jest avisará y habrá que cambiarlo a `it`.
  it.failing('seguridad · borra el x-internal-principal que mande el cliente', async () => {
    const res = await request(app.getHttpServer()).get('/api/v3/atracciones').set('x-internal-principal', 'falsificado');
    expect(res.status).toBe(200);
    expect(res.body.principal).toBeNull();
  });

  it('seguridad · con credencial, el principal del cliente se reemplaza por el firmado por el Gateway', async () => {
    const res = await request(app.getHttpServer()).get('/api/v3/atracciones').set('x-internal-principal', 'falsificado').set('X-API-Key', 'clave');
    expect(res.body.principal).not.toBe('falsificado');
    await expect(verifyInternalPrincipal(res.body.principal, SECRET)).resolves.toMatchObject({ id: '9' });
  });

  it('seguridad · las rutas del contrato nunca responden 429; fuera del contrato sí hay límite', async () => {
    const limited = await createGateway({
      port: 0,
      upstreams: { partnerApi: partnerApi.url, identity: identity.url, esb: esb.url, graphql: null },
      internalTokenSecret: SECRET,
      corsOrigins: [],
      rateLimitPerMinute: 2,
      apiKeyCacheMs: 60_000,
      tokenCacheMs: 30_000,
    });
    await limited.init();
    try {
      const contract: number[] = [];
      for (let i = 0; i < 5; i++) contract.push((await request(limited.getHttpServer()).get('/api/v3/atracciones')).status);
      expect(contract).not.toContain(429);
      const auth: number[] = [];
      for (let i = 0; i < 4; i++) auth.push((await request(limited.getHttpServer()).post('/api/v3/auth/login').send({})).status);
      expect(auth).toContain(429);
    } finally {
      await limited.close();
    }
  });

  it('seguridad · reenvía el X-Correlation-Id recibido y lo devuelve en la respuesta', async () => {
    const res = await request(app.getHttpServer()).get('/api/v3/atracciones').set('X-Correlation-Id', 'booking-corr-42');
    expect(res.headers['x-correlation-id']).toBe('booking-corr-42');
    expect(res.body.correlation).toBe('booking-corr-42');
  });
});
