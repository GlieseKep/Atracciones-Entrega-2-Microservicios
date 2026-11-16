import { randomUUID } from 'node:crypto';
import {
  checkHealth,
  createLogger,
  createRpcHttpService,
  EsbClient,
  InMemoryEventBus,
  listen,
  OutboxRelay,
  recordEvent,
  runWithContext,
  signInternalPrincipal,
  type EventBus,
  type RunningServer,
} from '@atracciones/platform';
import { createEsb, readEsbConfig } from '../../../apps/esb/src';
import { IdempotencyRepository } from '../../../apps/services/ms-booking/src/persistence/idempotency-repository';
import { createMsPricingService, readMsPricingConfig } from '../../../apps/services/ms-pricing/src';
import { msDatabase, type MsDatabase } from '../../../test/support/db';
import { FakeHttpServer } from '../../../test/support/fake-http';

process.env.LOG_SILENT = 'true';
const logger = createLogger('pruebas');
const SECRET = 'secreto-interno-de-pruebas-con-mas-de-32-caracteres';
const SERVICE_TOKEN = 'token-de-servicio-de-pruebas-con-32-caracteres-x';

describe('platform · idempotencia en PostgreSQL (repositorio de ms-booking)', () => {
  // `IdempotencyStore` de platform usa una tabla que solo tienen los servicios heredados (fuera del alcance); los ms-*
  // del alcance usan su propio IdempotencyRepository sobre `idempotencia`, que es lo que se prueba aquí.
  let db: MsDatabase;
  let repo: IdempotencyRepository;
  const subject = { tipo: 'CLIENTE_API' as const, id: 9 };

  beforeAll(async () => {
    db = await msDatabase('ms-booking');
    repo = new IdempotencyRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('dos solicitudes simultáneas con la misma clave → solo una queda como nueva', async () => {
    const key = randomUUID();
    const states = await Promise.all([repo.reserve(key, subject, 'Op', 'H'), repo.reserve(key, subject, 'Op', 'H')]);
    expect(states.map((s) => s.state).sort()).toEqual(['in_progress', 'new']);
  });

  it('solicitud en curso abandonada hace más de 2 min se vuelve a procesar', async () => {
    const key = randomUUID();
    await repo.reserve(key, subject, 'Op', 'H');
    await db.dataSource.query(`UPDATE idempotencia SET idem_creado_en = now() - interval '3 minutes' WHERE idem_clave = $1`, [key]);
    await expect(repo.reserve(key, subject, 'Op', 'H')).resolves.toEqual({ state: 'new' });
  });

  it('clave vencida (24 h) se puede reutilizar incluso con otro cuerpo; purgeExpired la borra', async () => {
    const key = randomUUID();
    await repo.reserve(key, subject, 'Op', 'H');
    await repo.complete(key, subject, { ok: 1 });
    await db.dataSource.query(`UPDATE idempotencia SET idem_expira_en = now() - interval '1 minute' WHERE idem_clave = $1`, [key]);
    await expect(repo.reserve(key, subject, 'Op', 'OTRO')).resolves.toEqual({ state: 'new' });
    await db.dataSource.query(`UPDATE idempotencia SET idem_expira_en = now() - interval '1 minute' WHERE idem_clave = $1`, [key]);
    await repo.purgeExpired();
    const [{ n }] = await db.dataSource.query(`SELECT count(*)::int AS n FROM idempotencia WHERE idem_clave = $1`, [key]);
    expect(n).toBe(0);
  });
});

describe('platform · outbox y OutboxRelay sobre ms_order', () => {
  let db: MsDatabase;
  const pending = async () => (await db.dataSource.query(`SELECT count(*)::int AS n FROM outbox WHERE publicado_en IS NULL`))[0].n as number;

  beforeAll(async () => {
    db = await msDatabase('ms-order');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('rollback de la transacción no deja el evento', async () => {
    await expect(db.dataSource.transaction(async (m) => {
      await recordEvent(m, { tipoEvento: 'OrdenCreada', agregadoId: 'ORD-RB', payload: {} });
      throw new Error('falla después de escribir');
    })).rejects.toThrow('falla');
    const [{ n }] = await db.dataSource.query(`SELECT count(*)::int AS n FROM outbox WHERE agregado_id = 'ORD-RB'`);
    expect(n).toBe(0);
  });

  it('el relay publica cada evento una sola vez, con la clave <servicio>.<tipo> y el correlation_id', async () => {
    await runWithContext({ correlationId: 'cid-relay' }, () => db.dataSource.transaction(async (m) => {
      await recordEvent(m, { tipoEvento: 'OrdenCreada', agregadoId: 'ORD-1', payload: { n: 1 } });
      await recordEvent(m, { tipoEvento: 'OrdenPagada', agregadoId: 'ORD-1', payload: { n: 2 } });
    }));
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    await bus.subscribe('q', ['order.*'], async (e) => { received.push(`${e.type}:${e.correlation_id}`); });
    const relay = new OutboxRelay(db.dataSource, bus, 'order', { logger });
    await expect(relay.publishPending()).resolves.toBe(2);
    await expect(relay.publishPending()).resolves.toBe(0);
    await bus.drain();
    expect(received.sort()).toEqual(['OrdenCreada:cid-relay', 'OrdenPagada:cid-relay']);
  });

  // DEFECTO-02 (Calidad/DEFECTOS_ENCONTRADOS.md): el relay ordena por (creado_en, id); los eventos de una misma
  // transacción comparten creado_en (now()) y el id es un UUID aleatorio, así que salen en orden azaroso. Aquí los UUID
  // se fijan al revés del orden de inserción para que el caso sea determinista.
  it.failing('el relay publica los eventos de una misma transacción en el orden en que se escribieron', async () => {
    await db.dataSource.transaction(async (m) => {
      for (const [id, tipo] of [['ffffffff-ffff-4fff-8fff-ffffffffffff', 'OrdenCreada'], ['00000000-0000-4000-8000-000000000001', 'OrdenPagada']]) {
        await m.query(`INSERT INTO outbox (id, event_id, tipo_evento, agregado_id, payload, correlation_id) VALUES ($1, $2, $3, 'ORD-ORDEN', '{}', 'cid')`, [id, randomUUID(), tipo]);
      }
    });
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    await bus.subscribe('q', ['order.*'], async (e) => { if (e.subject === 'ORD-ORDEN') received.push(e.type); });
    await new OutboxRelay(db.dataSource, bus, 'order', { logger }).publishPending();
    await bus.drain();
    expect(received).toEqual(['OrdenCreada', 'OrdenPagada']);
  });

  it('si el bus falla, el evento queda pendiente con su error y se publica en la siguiente vuelta', async () => {
    await db.dataSource.transaction((m) => recordEvent(m, { tipoEvento: 'OrdenCreada', agregadoId: 'ORD-2', payload: {} }));
    let fail = true;
    const bus = { publish: jest.fn(async () => { if (fail) throw new Error('bus caído'); }) } as unknown as EventBus;
    const relay = new OutboxRelay(db.dataSource, bus, 'order', { logger });
    await expect(relay.publishPending()).resolves.toBe(0);
    const [row] = await db.dataSource.query(`SELECT intentos, ultimo_error FROM outbox WHERE agregado_id = 'ORD-2'`);
    expect(row).toMatchObject({ intentos: 1, ultimo_error: expect.stringContaining('bus caído') });
    fail = false;
    await expect(relay.publishPending()).resolves.toBe(1);
    expect(await pending()).toBe(0);
  });
});

describe('platform · EsbClient, rpc-http, principal y health contra un ESB y ms-pricing reales', () => {
  let db: MsDatabase;
  let pricing: RunningServer;
  let esbServer: RunningServer;
  const slow = new FakeHttpServer();
  let esb: EsbClient;

  beforeAll(async () => {
    db = await msDatabase('ms-pricing');
    await slow.start();
    slow.on('POST', '/internal/rpc/Health', async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { body: { correlation: r.headers['x-correlation-id'] } };
    });
    const config = { ...readMsPricingConfig({}), internalTokenSecret: SECRET, serviceToken: SERVICE_TOKEN };
    const service = createMsPricingService(config, db.dataSource, { logger });
    pricing = await listen(createRpcHttpService({ service: 'ms-pricing', definition: service.definition, implementation: service.implementation, serviceToken: SERVICE_TOKEN, dataSource: db.dataSource, logger }), 0, '127.0.0.1');
    const esbConfig = { ...readEsbConfig({ SERVICE_TOKEN }), targets: { pricing: pricing.url, booking: slow.url } };
    esbServer = await listen(createEsb(esbConfig).app, 0, '127.0.0.1');
    esb = new EsbClient(esbServer.url, 2000, SERVICE_TOKEN);
  });
  afterAll(async () => {
    await esbServer.close();
    await pricing.close();
    await slow.stop();
    await db.drop();
  });

  it('correlación de ida y vuelta: el X-Correlation-Id del contexto llega al servicio a través del ESB', async () => {
    const body = await runWithContext({ correlationId: 'cid-esb-int' }, () => esb.call<{ correlation: string }>('booking', 'health'));
    expect(body.correlation).toBe('cid-esb-int');
  });

  it('ProblemDetails del servicio se propaga con su status y code (rpc-http → ESB → cliente)', async () => {
    await expect(esb.call('pricing', 'quoteTickets', { attraction_id: 'corto', date: '2026-11-25', boletos: [] })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(esb.call('pricing', 'quoteTickets', { attraction_id: 'PRhu4UBTWPBC', date: '2026-11-25', boletos: [{ ticket_type: 'ADULT', cantidad: 1 }] })).rejects.toMatchObject({ status: 422, code: 'PRICE_NOT_AVAILABLE' });
  });

  it('timeout del cliente → 503 SERVICE_UNAVAILABLE', async () => {
    await expect(new EsbClient(esbServer.url, 100, SERVICE_TOKEN).call('booking', 'health')).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('principal firmado por el Gateway es aceptado por el servicio (ADMIN lista tarifas)', async () => {
    const principalToken = await signInternalPrincipal({ tipo: 'USUARIO', id: '1', scopes: ['ADMIN'] }, SECRET);
    await expect(runWithContext({ correlationId: 'c', principalToken }, () => esb.call('pricing', 'listTariffs', { attraction_id: 'PRhu4UBTWPBC' }))).resolves.toEqual({ items: [] });
  });

  it('principal alterado o sin principal → 401', async () => {
    const token = await signInternalPrincipal({ tipo: 'USUARIO', id: '1', scopes: ['ADMIN'] }, `${SECRET}-otro`);
    await expect(runWithContext({ correlationId: 'c', principalToken: token }, () => esb.call('pricing', 'listTariffs', { attraction_id: 'PRhu4UBTWPBC' }))).rejects.toMatchObject({ status: 401 });
    await expect(esb.call('pricing', 'listTariffs', { attraction_id: 'PRhu4UBTWPBC' })).rejects.toMatchObject({ status: 401 });
  });

  it('health: servicio con base arriba → UP (vía ESB); con la base caída → DOWN', async () => {
    await expect(esb.call('pricing', 'health')).resolves.toMatchObject({ status: 'UP', database_connected: true });
    const other = await msDatabase('ms-pricing');
    await other.dataSource.destroy();
    await expect(checkHealth('ms-pricing', other.dataSource)).resolves.toMatchObject({ status: 'DOWN', database_connected: false });
    await other.drop();
  });
});
