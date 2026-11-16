import { createLogger, runWithContext } from '@atracciones/platform';
import { EsbRouter, readEsbConfig, type EsbConfig } from '../src/app';
import { ROUTES } from '../src/routes';

/** Los 12 servicios del alcance (sección 0.2) y su destino en la tabla del ESB. */
const SCOPE = ['catalog', 'inventory', 'booking', 'coupon', 'identity', 'order', 'pricing', 'payment', 'refund', 'location', 'billing', 'review'] as const;

const config = (overrides: Partial<EsbConfig> = {}): EsbConfig => ({
  ...readEsbConfig({ SERVICE_TOKEN: 'token-servicio' }),
  targets: Object.fromEntries(SCOPE.map((t) => [t, `http://${t}.local`])),
  ...overrides,
});

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('esb/routes · enrutamiento a los servicios del alcance', () => {
  let fetchSpy: jest.SpyInstance;
  let router: EsbRouter;

  beforeEach(() => {
    process.env.LOG_SILENT = 'true';
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => ok());
    router = new EsbRouter(config(), createLogger('pruebas'));
  });
  afterEach(() => {
    router.close();
    jest.restoreAllMocks();
  });

  it('cada servicio del alcance tiene rutas y su operación health', () => {
    const targets = new Set(Object.values(ROUTES).map((r) => r.target));
    for (const service of SCOPE) expect(targets).toContain(service);
    for (const key of ['booking.health', 'catalog.health', 'inventory.health', 'order.health', 'pricing.health', 'payment.health']) expect(ROUTES[key]).toBeDefined();
  });

  it('operación desconocida → 404 ROUTE_NOT_FOUND sin llamar a nadie', async () => {
    await expect(router.invoke('catalog.noExiste', {})).rejects.toMatchObject({ status: 404, code: 'ROUTE_NOT_FOUND' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parámetro de ruta: getAttraction llena :id y lo codifica', async () => {
    const route = ROUTES['catalog.getAttraction'];
    expect(route.protocol).toBe('rest');
    await router.invoke('catalog.getAttraction', { id: 'A 1/x' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`http://catalog.local${(route as { path: string }).path.replace(':id', encodeURIComponent('A 1/x'))}`);
  });

  it('parámetro de ruta faltante → 400 sin llamar al servicio', async () => {
    await expect(router.invoke('catalog.getAttraction', {})).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('GET: lo que no es parámetro de ruta va en la query (arreglos repetidos)', async () => {
    const [key] = Object.entries(ROUTES).find(([, r]) => r.protocol === 'rest' && r.method === 'GET' && r.target === 'catalog' && !r.path.includes(':'))!;
    await router.invoke(key, { page: 2, ids: ['a', 'b'], vacio: null });
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.getAll('ids')).toEqual(['a', 'b']);
    expect(url.searchParams.has('vacio')).toBe(false);
    expect(fetchSpy.mock.calls[0][1].body).toBeUndefined();
  });

  it('POST/PUT: lo que no es parámetro de ruta va en el cuerpo', async () => {
    await router.invoke('coupon.updateAgreement', { permite_promociones: true });
    const [, init] = fetchSpy.mock.calls[0];
    expect(['PUT', 'POST']).toContain(init.method);
    expect(JSON.parse(init.body)).toEqual({ permite_promociones: true });
  });

  it('RPC: booking, order, inventory y pricing van a POST /internal/rpc/<Método>', async () => {
    for (const service of ['booking', 'order', 'inventory', 'pricing']) {
      const rpc = Object.values(ROUTES).filter((r) => r.target === service && r.protocol === 'rest');
      expect(rpc.length).toBeGreaterThan(0);
      for (const r of rpc) expect(r).toMatchObject({ method: 'POST', path: expect.stringMatching(/^\/internal\/rpc\/[A-Z]\w+$/) });
    }
    await router.invoke('booking.createReservation', { slot_id: 's' });
    expect(fetchSpy.mock.calls[0][0]).toBe('http://booking.local/internal/rpc/CreateReservation');
  });

  it('envía X-Service-Token y conserva la correlación de la petición', async () => {
    await runWithContext({ correlationId: 'cid-esb-1', principalToken: 'p' }, () => router.invoke('booking.getReservation', { id: 'R1' }));
    expect(fetchSpy.mock.calls[0][1].headers).toMatchObject({ 'x-service-token': 'token-servicio', 'x-correlation-id': 'cid-esb-1', 'x-internal-principal': 'p' });
  });

  it('el plazo de la ruta se multiplica por ESB_TIMEOUT_FACTOR', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const slow = new EsbRouter(config({ timeoutFactor: 3 }), createLogger('pruebas'));
    try {
      await slow.invoke('booking.createReservation', {});
      expect(timeout).toHaveBeenCalledWith(20000 * 3);
    } finally {
      slow.close();
    }
  });

  it('un 4xx del servicio se propaga y no abre el circuito; los 5xx repetidos sí lo abren → 503', async () => {
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ status: 404, code: 'NOT_FOUND', detail: 'x' }), { status: 404 }));
    for (let i = 0; i < 6; i++) await expect(router.invoke('booking.getReservation', { id: 'X' })).rejects.toMatchObject({ status: 404 });
    fetchSpy.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
    for (let i = 0; i < 6; i++) await router.invoke('booking.listEvents', {}).catch(() => undefined);
    await expect(router.invoke('booking.listEvents', {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining('circuito abierto') });
  });
});
