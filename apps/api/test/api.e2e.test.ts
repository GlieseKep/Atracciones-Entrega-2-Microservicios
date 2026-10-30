import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ensureAvailability } from '@atracciones/data-access';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ALL_SCOPES, grantCatalogWrite, inDays, SEEDED, startApi, token } from './helpers';

let app: INestApplication;
let dataSource: DataSource;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  ({ app, dataSource } = await startApi());
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
  await dataSource.destroy();
});

/** Usuario con perfil aprovisionado. */
async function customer(scope = ALL_SCOPES) {
  const sub = randomUUID();
  const email = `${sub.slice(0, 8)}@example.com`;
  const auth = `Bearer ${await token({ sub, email, scope })}`;
  await http.post('/internal/web/v1/auth/register').set('Authorization', auth).send({}).expect(201);
  return { sub, email, auth };
}

const idem = () => ({ 'Idempotency-Key': randomUUID() });

describe('salud y documentación', () => {
  it('expone /health y el documento OpenAPI sin token', async () => {
    await http.get('/health').expect(200, { status: 'ok' });
    await http.get('/internal/web/v1/atracciones/health').expect(200);
    const doc = await http.get('/openapi/v1.json').expect(200);
    expect(Object.keys(doc.body.paths)).toEqual(expect.arrayContaining(['/internal/web/v1/atracciones/search', '/internal/web/v1/payments/simulations']));
  });
});

describe('autenticación y scopes', () => {
  it('rechaza solicitudes sin token con problem+json y WWW-Authenticate', async () => {
    const res = await http.get('/internal/web/v1/users/me').expect(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHORIZED', type: 'urn:atracciones:problems:unauthorized' });
    expect(res.body.traceId).toBeTruthy();
  });

  it('rechaza tokens con otra firma, otro emisor o expirados', async () => {
    for (const bad of [await token({ secret: 'otro-secreto-de-al-menos-32-caracteres!!' }), await token({ issuer: 'evil' }), await token({ expiresIn: '-5m' })]) {
      await http.get('/internal/web/v1/users/me').set('Authorization', `Bearer ${bad}`).expect(401);
    }
  });

  it('permite leer el catálogo sin token, pero no modificarlo', async () => {
    const list = await http.get('/internal/web/v1/atracciones').expect(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    const id = list.body.data[0].id;
    await http.get(`/internal/web/v1/atracciones/${id}`).expect(200);
    await http.get(`/internal/web/v1/atracciones/${id}/availability`).query({ date: inDays(5) }).expect(200);
    const search = await http.post('/internal/web/v1/atracciones/search').send({ rows: 2 }).expect(200);
    expect(search.body.data).toHaveLength(2);
    await http.post('/internal/web/v1/atracciones/details').send({ attractions: [id] }).expect(200);

    await http.post('/internal/web/v1/atracciones').set(idem()).send({}).expect(401);
    await http.delete(`/internal/web/v1/atracciones/${id}`).set(idem()).expect(401);
    await http.post(`/internal/web/v1/atracciones/${id}/reservations`).set(idem()).send({}).expect(401);
    await http.get('/internal/web/v1/atracciones/reservations').expect(401);
  });

  it('exige el scope de cada operación', async () => {
    const readOnly = `Bearer ${await token({ scope: 'attractions:read' })}`;
    await http.get('/internal/web/v1/atracciones').set('Authorization', readOnly).expect(200);
    const res = await http.post('/internal/web/v1/auth/register').set('Authorization', readOnly).send({}).expect(403);
    expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('perfil', () => {
  it('aprovisiona el perfil una sola vez a partir de los claims', async () => {
    const auth = `Bearer ${await token({ sub: 'perfil-1', email: 'perfil1@example.com' })}`;
    await http.get('/internal/web/v1/users/me').set('Authorization', auth).expect(404);
    const first = await http.post('/internal/web/v1/auth/register').set('Authorization', auth).send({ billingName: 'Perfil Uno' }).expect(201);
    expect(first.headers.location).toBe('/internal/web/v1/users/me');
    const second = await http.post('/internal/web/v1/auth/register').set('Authorization', auth).send({}).expect(200);
    expect(second.body.id).toBe(first.body.id);
    const me = await http.get('/internal/web/v1/customers/me').set('Authorization', auth).expect(200);
    expect(me.body.billingName).toBe('Perfil Uno');
  });

  it('rechaza identidades enviadas en el cuerpo y referencias de pago que parecen tarjetas', async () => {
    const { auth } = await customer();
    const sub = await http.post('/internal/web/v1/auth/register').set('Authorization', auth).send({ sub: 'otro' }).expect(400);
    expect(sub.body.errors).toHaveProperty('sub');
    await http
      .put('/internal/web/v1/customers/me')
      .set('Authorization', auth)
      .send({ billingName: 'Ana', billingEmail: 'ana@example.com', billingAddress: 'Quito', paymentMethodReference: '4111111111111111' })
      .expect(400);
  });
});

describe('catálogo', () => {
  it('pagina la búsqueda con tokens firmados ligados a los criterios', async () => {
    const { auth } = await customer();
    const first = await http.post('/internal/web/v1/atracciones/search').set('Authorization', auth).send({ rows: 4, sort: { by: 'price_asc' } }).expect(200);
    expect(first.body.metadata.totalResults).toBe(10);
    expect(first.body.data.map((a: { price: { total: number } }) => a.price.total)).toEqual([9.5, 12, 22, 25]);
    const second = await http
      .post('/internal/web/v1/atracciones/search')
      .set('Authorization', auth)
      .send({ rows: 4, sort: { by: 'price_asc' }, nextPage: first.body.metadata.nextPage })
      .expect(200);
    expect(second.body.data[0].price.total).toBe(35);
    await http.post('/internal/web/v1/atracciones/search').set('Authorization', auth).send({ rows: 5, nextPage: first.body.metadata.nextPage }).expect(400);
  });

  it('filtra por ciudad y valoración y expone enlaces HATEOAS', async () => {
    const { auth } = await customer();
    const res = await http
      .post('/internal/web/v1/atracciones/search')
      .set('Authorization', auth)
      .send({ cities: ['latacunga'], filters: { rating: { minimumReviewScore: 4.85 } } })
      .expect(200);
    expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([SEEDED.quilotoa]);
    expect(res.body.data[0]._links.availability).toBe(`/internal/web/v1/atracciones/${SEEDED.quilotoa}/availability`);
  });

  it('devuelve el detalle, disponibilidad por franja y 404 para identificadores inválidos', async () => {
    const { auth } = await customer();
    const detail = await http.get(`/internal/web/v1/atracciones/${SEEDED.teleferico}`).set('Authorization', auth).expect(200);
    expect(detail.headers['cache-control']).toBe('public, max-age=60');
    expect(detail.body).toMatchObject({ productType: 'SINGLE_TICKET', price: { currency: 'USD', total: 9.5 }, ratings: { numberOfReviews: 1250, score: 4.6 } });
    const availability = await http.get(`/internal/web/v1/atracciones/${SEEDED.teleferico}/availability?date=${inDays(10)}`).set('Authorization', auth).expect(200);
    expect(availability.body).toMatchObject({ timeZone: 'America/Guayaquil', availableSpots: 40 });
    expect(availability.body.times).toEqual([
      { time: '09:00', availableSpots: 20, status: 'AVAILABLE' },
      { time: '14:00', availableSpots: 20, status: 'AVAILABLE' },
    ]);
    await http.get('/internal/web/v1/atracciones/no-es-uuid').set('Authorization', auth).expect(404);
    await http.get(`/internal/web/v1/atracciones/${randomUUID()}`).set('Authorization', auth).expect(404);
  });
});

describe('compra directa y pagos', () => {
  it('crea un pedido pendiente con retención y lo paga; la reserva queda confirmada', async () => {
    const { auth } = await customer();
    const date = inDays(12);
    const purchase = await http
      .post(`/internal/web/v1/attractions/${SEEDED.mitad}/purchase`)
      .set('Authorization', auth)
      .set(idem())
      .send({ date, time: '09:00', quantity: 2 })
      .expect(201);
    expect(purchase.headers.location).toBe(`/internal/web/v1/orders/${purchase.body.orderId}`);
    expect(purchase.body).toMatchObject({ status: 'PENDING_PAYMENT', totalAmount: 50, currency: 'USD', unitPrice: { total: 25 } });
    expect(new Date(purchase.body.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const payment = await http
      .post('/internal/web/v1/payments/simulations')
      .set('Authorization', auth)
      .set(idem())
      .send({ orderId: purchase.body.orderId, paymentMethod: 'CARD', amount: 50, currency: 'USD' })
      .expect(201);
    expect(payment.body.status).toBe('SETTLED');

    const order = await http.get(`/internal/web/v1/orders/${purchase.body.orderId}`).set('Authorization', auth).expect(200);
    expect(order.body).toMatchObject({ status: 'PAID', paymentSimulation: { status: 'SETTLED', paymentMethod: 'CARD' } });
    const events = await http.get(`/internal/web/v1/orders/${purchase.body.orderId}/events`).set('Authorization', auth).expect(200);
    expect(events.body.events.map((e: { eventType: string }) => e.eventType)).toEqual(['ORDER_CREATED', 'PAYMENT_SETTLED']);
    const reservation = await http.get(`/internal/web/v1/atracciones/reservations/${purchase.body.reservationId}`).set('Authorization', auth).expect(200);
    expect(reservation.body.status).toBe('CONFIRMED');
  });

  it('rechaza importes distintos al total del pedido y propiedades desconocidas', async () => {
    const { auth } = await customer();
    const purchase = await http
      .post(`/internal/web/v1/attractions/${SEEDED.teleferico}/purchase`)
      .set('Authorization', auth)
      .set(idem())
      .send({ date: inDays(13), time: '09:00', quantity: 1 })
      .expect(201);
    const mismatch = await http
      .post('/internal/web/v1/payments/simulations')
      .set('Authorization', auth)
      .set(idem())
      .send({ orderId: purchase.body.orderId, paymentMethod: 'CARD', amount: 1, currency: 'USD' })
      .expect(422);
    expect(mismatch.body.code).toBe('AMOUNT_MISMATCH');
    const card = await http
      .post('/internal/web/v1/payments/simulations')
      .set('Authorization', auth)
      .set(idem())
      .send({ orderId: purchase.body.orderId, paymentMethod: 'CARD', amount: 9.5, currency: 'USD', cardNumber: '4111111111111111' })
      .expect(400);
    expect(card.body.errors).toHaveProperty('cardNumber');
  });

  it('cancela un pedido pendiente y libera los cupos', async () => {
    const { auth } = await customer();
    const date = inDays(14);
    const before = await http.get(`/internal/web/v1/atracciones/${SEEDED.cotopaxi}/availability?date=${date}`).set('Authorization', auth);
    const purchase = await http
      .post(`/internal/web/v1/attractions/${SEEDED.cotopaxi}/purchase`)
      .set('Authorization', auth)
      .set(idem())
      .send({ date, time: '14:00', quantity: 3 })
      .expect(201);
    const cancelled = await http
      .post(`/internal/web/v1/orders/${purchase.body.orderId}/cancel`)
      .set('Authorization', auth)
      .set(idem())
      .send({ reason: 'Ya no viajo' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const after = await http.get(`/internal/web/v1/atracciones/${SEEDED.cotopaxi}/availability?date=${date}`).set('Authorization', auth);
    expect(after.body.availableSpots).toBe(before.body.availableSpots);
    await http.post(`/internal/web/v1/orders/${purchase.body.orderId}/cancel`).set('Authorization', auth).set(idem()).send({ reason: 'otra vez' }).expect(409);
  });
});

describe('idempotencia', () => {
  it('repite la respuesta original sin duplicar efectos y rechaza otro payload con la misma clave', async () => {
    const { auth } = await customer();
    const date = inDays(15);
    const key = randomUUID();
    const body = { date, time: '09:00', quantity: 2 };
    const first = await http.post(`/internal/web/v1/attractions/${SEEDED.mindo}/purchase`).set('Authorization', auth).set('Idempotency-Key', key).send(body).expect(201);
    const replay = await http.post(`/internal/web/v1/attractions/${SEEDED.mindo}/purchase`).set('Authorization', auth).set('Idempotency-Key', key).send(body).expect(201);
    expect(replay.body).toEqual(first.body);
    const availability = await http.get(`/internal/web/v1/atracciones/${SEEDED.mindo}/availability?date=${date}`).set('Authorization', auth);
    expect(availability.body.times[0].availableSpots).toBe(18);

    const reused = await http
      .post(`/internal/web/v1/attractions/${SEEDED.mindo}/purchase`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send({ ...body, quantity: 3 })
      .expect(409);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('exige una Idempotency-Key UUID válida', async () => {
    const { auth } = await customer();
    for (const header of [undefined, 'no-es-uuid', '00000000-0000-0000-0000-000000000000']) {
      const req = http.post(`/internal/web/v1/attractions/${SEEDED.mindo}/purchase`).set('Authorization', auth);
      if (header) req.set('Idempotency-Key', header);
      const res = await req.send({ date: inDays(15), time: '09:00', quantity: 1 }).expect(400);
      expect(res.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    }
  });
});

describe('reservas', () => {
  it('no vende más cupos de los disponibles con solicitudes concurrentes', async () => {
    const { auth, email } = await customer();
    const date = inDays(20);
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        http
          .post(`/internal/web/v1/atracciones/${SEEDED.quilotoa}/reservations`)
          .set('Authorization', auth)
          .set(idem())
          .send({ date, time: '09:00', ticketCount: 1, customerName: 'Ana', customerEmail: email }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    const availability = await http.get(`/internal/web/v1/atracciones/${SEEDED.quilotoa}/availability?date=${date}`).set('Authorization', auth);
    expect(availability.body.times[0]).toEqual({ time: '09:00', availableSpots: 0, status: 'SOLD_OUT' });
  });

  it('solo el propietario ve o cancela una reserva', async () => {
    const owner = await customer();
    const other = await customer();
    const created = await http
      .post(`/internal/web/v1/atracciones/${SEEDED.teleferico}/reservations`)
      .set('Authorization', owner.auth)
      .set(idem())
      .send({ date: inDays(16), time: '14:00', ticketCount: 1, customerName: 'Ana', customerEmail: owner.email })
      .expect(201);
    const id = created.body.reservationId;
    await http.get(`/internal/web/v1/atracciones/reservations/${id}`).set('Authorization', other.auth).expect(404);
    await http.post(`/internal/web/v1/atracciones/reservations/${id}/cancel`).set('Authorization', other.auth).set(idem()).send({ reason: 'x' }).expect(404);
    const cancelled = await http.post(`/internal/web/v1/atracciones/reservations/${id}/cancel`).set('Authorization', owner.auth).set(idem()).send({ reason: 'Cambio' }).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const list = await http.get('/internal/web/v1/customers/me/reservations?status=CANCELLED').set('Authorization', owner.auth).expect(200);
    expect(list.body).toMatchObject({ totalItems: 1, currentPage: 1 });
  });

  it('valida fechas pasadas, formato de hora y campos obligatorios', async () => {
    const { auth } = await customer();
    const res = await http
      .post(`/internal/web/v1/atracciones/${SEEDED.teleferico}/reservations`)
      .set('Authorization', auth)
      .set(idem())
      .send({ date: '2020-01-01', time: '9:00', ticketCount: 0, customerName: '', customerEmail: 'no' })
      .expect(400);
    expect(Object.keys(res.body.errors).sort()).toEqual(['customerEmail', 'customerName', 'ticketCount', 'time']);
    const past = await http
      .post(`/internal/web/v1/atracciones/${SEEDED.teleferico}/reservations`)
      .set('Authorization', auth)
      .set(idem())
      .send({ date: '2020-01-01', time: '09:00', ticketCount: 1, customerName: 'Ana', customerEmail: 'ana@example.com' })
      .expect(400);
    expect(past.body.errors).toHaveProperty('date');
  });
});

describe('administración del catálogo', () => {
  it('exige scope de escritura y permiso local; registra cambios parciales y bloquea borrados con reservas', async () => {
    const admin = await customer(`${ALL_SCOPES} attractions:write`);
    const body = {
      name: 'Tour de prueba', longDescription: 'Descripción', duration: 'PT2H', price: { currency: 'USD', total: 10.51 },
      categories: ['Cultura'], badges: ['Nuevo'], locations: [{ address: 'Plaza Grande', city: 'Quito', country: 'EC' }], productType: 'GUIDED_TOUR',
    };
    const denied = await http.post('/internal/web/v1/atracciones').set('Authorization', admin.auth).set(idem()).send(body).expect(403);
    expect(denied.body.detail).toContain('catalog:write');

    await grantCatalogWrite(dataSource, admin.email);
    const created = await http.post('/internal/web/v1/atracciones').set('Authorization', admin.auth).set(idem()).send(body).expect(201);
    expect(created.headers.location).toBe(`/internal/web/v1/atracciones/${created.body.id}`);
    const patched = await http.patch(`/internal/web/v1/atracciones/${created.body.id}`).set('Authorization', admin.auth).set(idem()).send({ name: 'Tour editado' }).expect(200);
    expect(patched.body).toMatchObject({ name: 'Tour editado', badges: ['Nuevo'], categories: ['Cultura'] });

    // Precio con .51 → la pasarela simulada rechaza el pago; el pedido sigue pendiente y hay un máximo de 3 intentos.
    await ensureAvailability(dataSource, inDays(0), 30);
    const purchase = await http
      .post(`/internal/web/v1/attractions/${created.body.id}/purchase`)
      .set('Authorization', admin.auth)
      .set(idem())
      .send({ date: inDays(5), time: '09:00', quantity: 1 })
      .expect(201);
    for (let attempt = 0; attempt < 3; attempt++) {
      const pay = await http
        .post('/internal/web/v1/payments/simulations')
        .set('Authorization', admin.auth)
        .set(idem())
        .send({ orderId: purchase.body.orderId, paymentMethod: 'CARD', amount: 10.51, currency: 'USD' })
        .expect(201);
      expect(pay.body.status).toBe('REJECTED');
    }
    const exceeded = await http
      .post('/internal/web/v1/payments/simulations')
      .set('Authorization', admin.auth)
      .set(idem())
      .send({ orderId: purchase.body.orderId, paymentMethod: 'CARD', amount: 10.51, currency: 'USD' })
      .expect(409);
    expect(exceeded.body.code).toBe('PAYMENT_ATTEMPTS_EXCEEDED');

    const blocked = await http.delete(`/internal/web/v1/atracciones/${created.body.id}`).set('Authorization', admin.auth).set(idem()).expect(409);
    expect(blocked.body.code).toBe('ATTRACTION_HAS_ACTIVE_RESERVATIONS');
    const audit = await dataSource.query(`SELECT action FROM audit_events WHERE resource_id = $1 ORDER BY created_at`, [created.body.id]);
    expect(audit.map((a: { action: string }) => a.action)).toEqual(['attraction.create', 'attraction.patch']);
  });
});
