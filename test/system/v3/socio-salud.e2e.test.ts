import { expectContractHeaders, expectSchema, startE2E, type E2E } from './e2e-helpers';
import request from 'supertest';
import { API_KEY } from '../../fixtures/v3/seed';

/** E2E · P11, P13, T1 y T2. La salud DOWN detiene un servicio crítico: va al final del archivo. */
describe('E2E v3 · acuerdo de promociones, salud, autenticación y cabeceras', () => {
  let e2e: E2E;
  const gw = () => request(e2e.stack.gatewayUrl);

  beforeAll(async () => {
    e2e = await startE2E();
  }, 180_000);
  afterAll(async () => {
    await e2e?.close();
  });

  it('P11 · PUT del acuerdo y el GET siguiente refleja el cambio', async () => {
    const put = await gw().put('/api/v3/atracciones/promociones/contrato').set('X-API-Key', API_KEY)
      .send({ permite_promociones: true, porcentaje_descuento_maximo: 15, destinos_habilitados: ['Baños', 'Quito'], vigencia_hasta: '2027-12-31' });
    expect(put.status).toBe(200);
    expectSchema(put.body, 'PromocionesContratoResponse');
    const get = await gw().get('/api/v3/atracciones/promociones/contrato').set('X-API-Key', API_KEY);
    expect(get.status).toBe(200);
    expectContractHeaders(get);
    expectSchema(get.body, 'PromocionesContratoResponse');
    expect(get.body).toMatchObject({ permite_promociones: true, porcentaje_descuento_maximo: 15, destinos_habilitados: ['Baños', 'Quito'], vigencia_hasta: '2027-12-31' });
  });

  it('T1 · sin credencial en una operación protegida → 401', async () => {
    const res = await gw().get('/api/v3/atracciones/promociones/contrato');
    expect(res.status).toBe(401);
    expectContractHeaders(res);
    expectSchema(res.body, 'ProblemDetails');
  });

  it('T1 · X-API-Key válida → acceso a una operación protegida', async () => {
    await gw().get('/api/v3/atracciones/eventos').set('X-API-Key', API_KEY).expect(200);
  });

  it('T2 · X-Correlation-Id enviado vuelve igual y uno ausente se genera; un error trae problem+json con code, correlation_id y timestamp', async () => {
    const sent = await gw().get('/api/v3/atracciones/categorias').set('X-Correlation-Id', 'booking-e2e-cid-1');
    expect(sent.headers['x-correlation-id']).toBe('booking-e2e-cid-1');
    const generated = await gw().get('/api/v3/atracciones/categorias');
    expect(generated.headers['x-correlation-id']).toMatch(/^cid-/);
    const error = await gw().get('/api/v3/atracciones/NOEXISTE1234').set('X-Correlation-Id', 'booking-e2e-cid-2');
    expect(error.status).toBe(404);
    expectContractHeaders(error);
    expect(error.body.correlation_id).toBe('booking-e2e-cid-2');
  });

  it('P13 · salud del nodo con todos los servicios arriba → 200', async () => {
    const res = await gw().get('/api/v3/atracciones/health');
    expect(res.status).toBe(200);
    expectContractHeaders(res);
    expectSchema(res.body, 'NodeHealthResponse');
    // El semáforo distingue UP de DEGRADED por la latencia real de la máquina; DOWN sería un servicio caído.
    expect(['UP', 'DEGRADED']).toContain(res.body.status);
    expect(res.body.database_connected).toBe(true);
  });

  it('P13 · con un nodo crítico detenido (ms-inventory) → 503 DOWN', async () => {
    await e2e.stack.stop('ms-inventory');
    const res = await gw().get('/api/v3/atracciones/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('DOWN');
  });
});
