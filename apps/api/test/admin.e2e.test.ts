import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
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

const idem = () => ({ 'Idempotency-Key': randomUUID() });

async function customer(scope = ALL_SCOPES, billingName?: string) {
  const sub = randomUUID();
  const email = `${sub.slice(0, 8)}@admin-tests.com`;
  const auth = `Bearer ${await token({ sub, email, scope })}`;
  await http.post('/internal/web/v1/auth/register').set('Authorization', auth).send(billingName ? { billingName } : {}).expect(201);
  return { sub, email, auth };
}

async function admin() {
  const user = await customer(`${ALL_SCOPES} attractions:write`, 'Admin Pruebas');
  await grantCatalogWrite(dataSource, user.email);
  return user;
}

describe('panel de administración', () => {
  it('exige el scope de escritura y el permiso local admin:manage', async () => {
    const buyer = await customer();
    await http.get('/internal/web/v1/admin/summary').set('Authorization', buyer.auth).expect(403);
    const writer = await customer(`${ALL_SCOPES} attractions:write`);
    const denied = await http.get('/internal/web/v1/admin/customers').set('Authorization', writer.auth).expect(403);
    expect(denied.body.detail).toContain('admin:manage');
    const { auth } = await admin();
    await http.get('/internal/web/v1/admin/summary').set('Authorization', auth).expect(200);
  });

  it('lista clientes, reservas, pedidos y pagos de todos los usuarios', async () => {
    const { auth } = await admin();
    const buyer = await customer(ALL_SCOPES, 'Cliente Visible');
    const purchase = await http
      .post(`/internal/web/v1/attractions/${SEEDED.mitad}/purchase`)
      .set('Authorization', buyer.auth)
      .set(idem())
      .send({ date: inDays(20), time: '09:00', quantity: 2 })
      .expect(201);
    await http
      .post('/internal/web/v1/payments/simulations')
      .set('Authorization', buyer.auth)
      .set(idem())
      .send({ orderId: purchase.body.orderId, paymentMethod: 'CARD', amount: 50, currency: 'USD' })
      .expect(201);

    const customers = await http.get('/internal/web/v1/admin/customers').query({ search: buyer.email }).set('Authorization', auth).expect(200);
    expect(customers.body).toMatchObject({ totalItems: 1, currentPage: 1 });
    expect(customers.body.data[0]).toMatchObject({ email: buyer.email, name: 'Cliente Visible', status: 'ACTIVE', orders: 1, totalSpent: 50, roles: [] });

    const reservations = await http.get('/internal/web/v1/admin/reservations').query({ search: buyer.email }).set('Authorization', auth).expect(200);
    expect(reservations.body.data[0]).toMatchObject({ customerEmail: buyer.email, ticketCount: 2, status: 'CONFIRMED', time: '09:00', date: inDays(20) });

    const orders = await http.get('/internal/web/v1/admin/orders').query({ search: buyer.email, status: 'PAID' }).set('Authorization', auth).expect(200);
    expect(orders.body.data[0]).toMatchObject({ id: purchase.body.orderId, quantity: 2, total: { amount: 50 }, refunded: 0, paymentStatus: 'SETTLED', holdExpiresAt: null });
    expect(reservations.body.data[0]).toMatchObject({ orderId: purchase.body.orderId, orderStatus: 'PAID' });

    const payments = await http.get('/internal/web/v1/admin/payments').query({ search: buyer.email }).set('Authorization', auth).expect(200);
    expect(payments.body.data[0]).toMatchObject({ orderId: purchase.body.orderId, status: 'SETTLED', attempts: 1, amount: { amount: 50 } });

    const summary = await http.get('/internal/web/v1/admin/summary').set('Authorization', auth).expect(200);
    expect(summary.body.customers).toBeGreaterThanOrEqual(2);
    expect(summary.body.revenue[0].amount).toBeGreaterThanOrEqual(50);

    const report = await http.get('/internal/web/v1/admin/reports/sales').set('Authorization', auth).expect(200);
    expect(report.body.byAttraction.find((r: { attractionId: string }) => r.attractionId === SEEDED.mitad).tickets).toBeGreaterThanOrEqual(2);

    await http.get('/internal/web/v1/admin/orders').query({ status: 'NOPE' }).set('Authorization', auth).expect(400);
  });

  it('muestra el detalle de un pedido y cancela pedidos pendientes liberando los cupos', async () => {
    const { auth } = await admin();
    const buyer = await customer();
    const date = inDays(23);
    const slotQuery = { attractionId: SEEDED.quilotoa, fromDate: date, toDate: date };
    const before = await http.get('/internal/web/v1/admin/availability').query(slotQuery).set('Authorization', auth).expect(200);
    const reservedBefore = before.body.data.find((s: { time: string }) => s.time === '09:00').reserved;

    const pending = await http
      .post(`/internal/web/v1/attractions/${SEEDED.quilotoa}/purchase`)
      .set('Authorization', buyer.auth)
      .set(idem())
      .send({ date, time: '09:00', quantity: 2 })
      .expect(201);
    const orderId = pending.body.orderId;

    const detail = await http.get(`/internal/web/v1/admin/orders/${orderId}`).set('Authorization', auth).expect(200);
    expect(detail.body).toMatchObject({ status: 'PENDING_PAYMENT', reservationStatus: 'PENDING', payments: [], items: [{ quantity: 2, serviceTime: '09:00' }] });
    expect(new Date(detail.body.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(detail.body.events.map((e: { eventType: string }) => e.eventType)).toEqual(['ORDER_CREATED']);

    await http.post(`/internal/web/v1/admin/orders/${orderId}/cancel`).set('Authorization', auth).send({ reason: 'x' }).expect(400);
    const key = idem();
    const cancelled = await http.post(`/internal/web/v1/admin/orders/${orderId}/cancel`).set('Authorization', auth).set(key).send({ reason: 'Pedido duplicado' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Pedido duplicado', reservationStatus: 'CANCELLED', holdExpiresAt: null });
    await http.post(`/internal/web/v1/admin/orders/${orderId}/cancel`).set('Authorization', auth).set(key).send({ reason: 'Pedido duplicado' }).expect(200);
    await http.post(`/internal/web/v1/admin/orders/${orderId}/cancel`).set('Authorization', auth).set(idem()).send({ reason: 'Otra vez' }).expect(409);

    const after = await http.get('/internal/web/v1/admin/availability').query(slotQuery).set('Authorization', auth).expect(200);
    expect(after.body.data.find((s: { time: string }) => s.time === '09:00').reserved).toBe(reservedBefore);
    await http.post(`/internal/web/v1/admin/orders/${orderId}/refunds`).set('Authorization', auth).set(idem()).send({ reason: 'No aplica' }).expect(409);
  });

  it('reembolsa pedidos pagados en parcial y total sin superar lo cobrado', async () => {
    const { auth } = await admin();
    const buyer = await customer();
    const date = inDays(24);
    const paid = await http
      .post(`/internal/web/v1/attractions/${SEEDED.mitad}/purchase`)
      .set('Authorization', buyer.auth)
      .set(idem())
      .send({ date, time: '14:00', quantity: 2 })
      .expect(201);
    const orderId = paid.body.orderId;
    await http
      .post('/internal/web/v1/payments/simulations')
      .set('Authorization', buyer.auth)
      .set(idem())
      .send({ orderId, paymentMethod: 'CARD', amount: 50, currency: 'USD' })
      .expect(201);

    await http.post(`/internal/web/v1/admin/orders/${orderId}/cancel`).set('Authorization', auth).set(idem()).send({ reason: 'No se puede' }).expect(409);
    await http.post(`/internal/web/v1/admin/orders/${orderId}/refunds`).set('Authorization', auth).set(idem()).send({ amount: 50.01, reason: 'Demasiado' }).expect(409);
    await http.post(`/internal/web/v1/admin/orders/${orderId}/refunds`).set('Authorization', auth).set(idem()).send({ amount: 1.234, reason: 'Decimales' }).expect(400);

    const partial = await http.post(`/internal/web/v1/admin/orders/${orderId}/refunds`).set('Authorization', auth).set(idem()).send({ amount: 20, reason: 'Una entrada sin usar' }).expect(200);
    expect(partial.body).toMatchObject({ status: 'PARTIALLY_REFUNDED', refunded: 20, reservationStatus: 'CONFIRMED' });
    expect(partial.body.payments[0]).toMatchObject({ status: 'PARTIALLY_REFUNDED', refunded: 20 });
    await http.post(`/internal/web/v1/admin/orders/${orderId}/refunds`).set('Authorization', auth).set(idem()).send({ amount: 30.01, reason: 'Excede' }).expect(409);

    const full = await http.post(`/internal/web/v1/admin/orders/${orderId}/refunds`).set('Authorization', auth).set(idem()).send({ reason: 'Visita cancelada' }).expect(200);
    expect(full.body).toMatchObject({ status: 'REFUNDED', refunded: 50, reservationStatus: 'CANCELLED' });
    expect(full.body.events.map((e: { newStatus: string }) => e.newStatus)).toEqual(['PENDING_PAYMENT', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
    expect(full.body.payments[0].events.filter((e: { amount: number | null }) => e.amount !== null).map((e: { amount: number }) => e.amount)).toEqual([20, 30]);
    await http.post(`/internal/web/v1/admin/orders/${orderId}/refunds`).set('Authorization', auth).set(idem()).send({ reason: 'Otra' }).expect(409);

    const audit = await dataSource.query(`SELECT action FROM audit_events WHERE resource_id = $1 ORDER BY created_at`, [orderId]);
    expect(audit.map((a: { action: string }) => a.action)).toEqual(['order.partially_refunded', 'order.refunded']);
  });

  it('gestiona la capacidad y crea franjas sin bajar de lo reservado', async () => {
    const { auth } = await admin();
    const buyer = await customer();
    const date = inDays(21);
    await http
      .post(`/internal/web/v1/atracciones/${SEEDED.cotopaxi}/reservations`)
      .set('Authorization', buyer.auth)
      .set(idem())
      .send({ date, time: '14:00', ticketCount: 3, customerName: 'Ana', customerEmail: buyer.email })
      .expect(201);

    const slots = await http
      .get('/internal/web/v1/admin/availability')
      .query({ attractionId: SEEDED.cotopaxi, fromDate: date, toDate: date })
      .set('Authorization', auth)
      .expect(200);
    const slot = slots.body.data.find((s: { time: string }) => s.time === '14:00');
    expect(slot).toMatchObject({ reserved: 3, capacity: 20 });

    const blocked = await http.patch(`/internal/web/v1/admin/availability/${slot.id}`).set('Authorization', auth).send({ capacity: 2 }).expect(409);
    expect(blocked.body.detail).toContain('3');
    const updated = await http.patch(`/internal/web/v1/admin/availability/${slot.id}`).set('Authorization', auth).send({ capacity: 3 }).expect(200);
    expect(updated.body.capacity).toBe(3);
    const full = await http.get('/internal/web/v1/admin/availability').query({ attractionId: SEEDED.cotopaxi, status: 'FULL' }).set('Authorization', auth).expect(200);
    expect(full.body.data.map((s: { id: string }) => s.id)).toContain(slot.id);

    const created = await http
      .post('/internal/web/v1/admin/availability')
      .set('Authorization', auth)
      .send({ attractionId: SEEDED.cotopaxi, date, time: '17:30', capacity: 8 })
      .expect(201);
    expect(created.body).toMatchObject({ time: '17:30', capacity: 8, reserved: 0 });
    await http.post('/internal/web/v1/admin/availability').set('Authorization', auth).send({ attractionId: SEEDED.cotopaxi, date, time: '17:30', capacity: 8 }).expect(409);
    const audit = await dataSource.query(`SELECT action FROM audit_events WHERE resource_id = $1`, [slot.id]);
    expect(audit.map((a: { action: string }) => a.action)).toContain('availability.capacity_changed');

    const log = await http.get('/internal/web/v1/admin/audit').query({ search: slot.id, status: 'availability' }).set('Authorization', auth).expect(200);
    expect(log.body.data[0]).toMatchObject({ action: 'availability.capacity_changed', resourceType: 'availability', resourceId: slot.id, reason: '20 -> 3' });
    expect(log.body.data[0].actorEmail).toMatch(/@admin-tests\.com$/);
    await http.get('/internal/web/v1/admin/audit').query({ status: 'payment' }).set('Authorization', auth).expect(400);
  });

  it('expone el estado de la base de datos y las métricas HTTP solo a administradores', async () => {
    const buyer = await customer();
    await http.get('/internal/web/v1/admin/observability').set('Authorization', buyer.auth).expect(403);
    await http.get('/internal/web/v1/admin/audit').set('Authorization', buyer.auth).expect(403);

    const { auth } = await admin();
    const res = await http.get('/internal/web/v1/admin/observability').set('Authorization', auth).expect(200);
    expect(res.body.database).toMatchObject({ status: 'ok', error: null });
    expect(res.body.requests.total).toBeGreaterThan(0);
    expect(res.body.requests.byStatusClass['4xx']).toBeGreaterThan(0);
    expect(res.body.timeline).toHaveLength(60);
    expect(res.body.latencyMs.p95).toBeGreaterThanOrEqual(res.body.latencyMs.p50);
    expect(res.body.routes.some((r: { route: string }) => r.route.includes('/admin/'))).toBe(true);
  });

  it('cambia el estado de usuarios y asigna o revoca roles', async () => {
    const me = await admin();
    const target = await customer();
    const [{ id: userId }] = await dataSource.query(`SELECT id FROM users WHERE email = $1`, [target.email]);
    const roles = await http.get('/internal/web/v1/admin/roles').set('Authorization', me.auth).expect(200);
    const adminRole = roles.body.find((r: { name: string }) => r.name === 'admin');
    expect(adminRole.permissions).toEqual(expect.arrayContaining(['catalog:write', 'admin:manage']));

    const granted = await http.post(`/internal/web/v1/admin/customers/${userId}/roles`).set('Authorization', me.auth).send({ roleId: adminRole.id }).expect(201);
    expect(granted.body.roles).toEqual(['admin']);
    const revoked = await http.delete(`/internal/web/v1/admin/customers/${userId}/roles/${adminRole.id}`).set('Authorization', me.auth).expect(200);
    expect(revoked.body.roles).toEqual([]);

    const disabled = await http.put(`/internal/web/v1/admin/customers/${userId}/status`).set('Authorization', me.auth).send({ status: 'DISABLED' }).expect(200);
    expect(disabled.body.status).toBe('DISABLED');
    await http
      .post(`/internal/web/v1/attractions/${SEEDED.mitad}/purchase`)
      .set('Authorization', target.auth)
      .set(idem())
      .send({ date: inDays(22), time: '09:00', quantity: 1 })
      .expect(403);

    const [{ id: myId }] = await dataSource.query(`SELECT id FROM users WHERE email = $1`, [me.email]);
    await http.put(`/internal/web/v1/admin/customers/${myId}/status`).set('Authorization', me.auth).send({ status: 'DISABLED' }).expect(409);
    await http.delete(`/internal/web/v1/admin/customers/${myId}/roles/${adminRole.id}`).set('Authorization', me.auth).expect(409);
  });
});
