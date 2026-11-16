import request from 'supertest';
import { authHeaders, partnerApiWithEsb, SOCIO } from '../../test/helpers';
import { toEventItem } from './events';

const item = (n: number, type = 'RESERVA_CREADA') => ({
  specversion: '1.0', source: '/servicios/booking', event_id: `e${n}`, sequence_number: n, event_type: type,
  aggregate_id: 'PNR1', correlation_id: 'cid', timestamp: '2026-11-20T12:00:00.000Z', payload_json: JSON.stringify({ n }),
});

describe('partner-api/handlers/events · P12 feed Outbox', () => {
  let auth: Record<string, string>;
  beforeAll(async () => {
    auth = await authHeaders(SOCIO);
  });
  afterEach(() => jest.restoreAllMocks());

  it('filtros type y after llegan a Booking; payload y data llevan el mismo contenido', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({ events: [item(5, 'STOCK_ACTUALIZADO')] }));
    const res = await request(api.app).get('/api/v3/atracciones/eventos?after=4&type=STOCK_ACTUALIZADO').set(auth).expect(200);
    expect(esb).toHaveBeenCalledWith('booking', 'listEvents', { after: 4, limit: 50, type: 'STOCK_ACTUALIZADO' });
    expect(res.body[0]).toMatchObject({ event_id: 'e5', payload: { n: 5 }, data: { n: 5 } });
    expect(res.body[0]).not.toHaveProperty('payload_json');
  });

  it('limit mayor que 200 se acota a 200 en vez de rechazarse; tipo fuera del enum se rechaza sin llegar a Booking', async () => {
    const { api, esb } = partnerApiWithEsb(() => ({ events: [] }));
    await request(api.app).get('/api/v3/atracciones/eventos?limit=500').set(auth).expect(200);
    expect(esb.mock.calls[0][2]).toMatchObject({ limit: 200 });
    // GET /eventos no documenta 400 en el contrato v3: la regla de la Partner API cambia el 4xx por 500 y conserva el code.
    const res = await request(api.app).get('/api/v3/atracciones/eventos?type=OTRO').set(auth);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(esb).toHaveBeenCalledTimes(1);
  });

  it('lista vacía → [] con Cache-Control no-store', async () => {
    const { api } = partnerApiWithEsb(() => ({}));
    await request(api.app).get('/api/v3/atracciones/eventos').set(auth).expect(200, []).expect('Cache-Control', 'no-store');
  });

  it('toEventItem: payload_json inválido o vacío → payload {}', () => {
    expect(toEventItem({ ...item(1), payload_json: '{roto' })).toMatchObject({ payload: {}, data: {} });
    expect(toEventItem({ ...item(1), payload_json: '' })).toMatchObject({ payload: {} });
  });
});
