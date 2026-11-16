import { AppError, type EsbClient, type EventBus } from '@atracciones/platform';
import request from 'supertest';
import { partnerApiWithEsb, testConfig } from '../test/helpers';
import { NodeHealth } from './health';

const up = { status: 'UP', database_connected: true };

/** Stub del ESB: responde la salud de cada servicio según el mapa (o lanza si el servicio está "caído"). */
const esbStub = (state: Record<string, 'UP' | 'DOWN' | 'CAIDO'>) =>
  ({
    call: jest.fn(async (service: string) => {
      if (state[service] === 'CAIDO') throw AppError.unavailable();
      return state[service] === 'DOWN' ? { status: 'DOWN', database_connected: false } : up;
    }),
  }) as unknown as EsbClient & { call: jest.Mock };

describe('partner-api/health · P13 salud agregada del nodo', () => {
  // El semáforo depende de la latencia medida: se fija el reloj de alta resolución para que no dependa de la carga
  // de la máquina (sin esto el caso UP sale DEGRADED cuando Jest corre en paralelo).
  beforeEach(() => {
    jest.spyOn(performance, 'now').mockReturnValue(1000);
    // Igual con la memoria: un worker de Jest puede pasar de 1 GB de RSS y volver el semáforo DEGRADED.
    jest.spyOn(process, 'memoryUsage').mockReturnValue({ rss: 200 * 1024 * 1024, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 });
  });
  afterEach(() => jest.restoreAllMocks());

  it('críticos y opcionales arriba → UP con los campos del NodeHealthResponse', async () => {
    const report = await new NodeHealth(esbStub({}), testConfig()).report();
    expect(report).toMatchObject({ status: 'UP', node_id: 'node-test', node_code: 'TEST', version: '3.0.0', database_connected: true, rabbitmq_status: 'IN_MEMORY' });
  });

  it('un crítico caído → DOWN', async () => {
    expect((await new NodeHealth(esbStub({ booking: 'CAIDO' }), testConfig()).report()).status).toBe('DOWN');
  });

  it('un opcional caído → DEGRADED (las ventas siguen); RabbitMQ desconectado → DEGRADED', async () => {
    expect((await new NodeHealth(esbStub({ refund: 'DOWN' }), testConfig()).report()).status).toBe('DEGRADED');
    const health = new NodeHealth(esbStub({}), testConfig());
    health.watch({ status: () => 'DISCONNECTED' } as unknown as EventBus);
    expect((await health.report()).status).toBe('DEGRADED');
  });

  it('la ruta del contrato responde 200 con UP y 503 con DOWN', async () => {
    const ok = partnerApiWithEsb(() => up);
    await request(ok.api.app).get('/api/v3/atracciones/health').expect(200);
    ok.esb.mockRestore();
    const down = partnerApiWithEsb((service) => { if (service === 'catalog') throw AppError.unavailable(); return up; });
    const res = await request(down.api.app).get('/api/v3/atracciones/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('DOWN');
  });

  it('el resultado se guarda durante cacheMs (Booking consulta cada 5 s)', async () => {
    const esb = esbStub({});
    const health = new NodeHealth(esb, testConfig({ health: { critical: ['catalog'], optional: [], cacheMs: 60_000, timeoutMs: 100 } }));
    await health.report();
    await health.report();
    expect(esb.call).toHaveBeenCalledTimes(1);
  });
});
