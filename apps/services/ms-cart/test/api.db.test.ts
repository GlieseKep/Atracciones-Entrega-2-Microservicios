process.env.LOG_SILENT = 'true';

import { randomUUID } from 'node:crypto';
import { servicePrincipal, signInternalPrincipal, type Principal } from '@atracciones/platform';
import request from 'supertest';
import { createMsCartService, readMsCartConfig, type CartLookups } from '../src';
import { freshDatabase, type TestDatabase } from './database';

const SECRET = 'secreto-interno-de-pruebas-con-32-caracteres-o-mas';
const NOW = new Date('2026-10-25T15:00:00Z'); // 10:00 en Ecuador
const MAX_ITEMS = 4;

/** Catalog e Inventory simulados: tres atracciones (una con slug) y turnos a la venta salvo a las 23:00. */
const CODES: Record<string, string> = {
  PRhu4UBTWPBC: 'PRhu4UBTWPBC',
  'quito-city-tour': 'PRhu4UBTWPBC',
  BnosAventur1: 'BnosAventur1',
  CuencaColon1: 'CuencaColon1',
  GalapagosAA1: 'GalapagosAA1',
  MindoNublad1: 'MindoNublad1',
};
const lookups: CartLookups = {
  attractionCode: async (id) => CODES[id] ?? null,
  slotOnSale: async (_code, slot) => slot.time !== '23:00:00',
};

const user = (id: string): Principal => ({ tipo: 'USUARIO', id, scopes: ['attractions:read', 'attractions:book'], nombre: 'Cliente', email: `${id}@test.ec` });
const partner: Principal = { tipo: 'API_CLIENTE', id: randomUUID(), scopes: ['attractions:read', 'attractions:book'], nombre: 'Booking Prototipo' };

describe('ms_cart · API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createMsCartService>['app'];
  let repository: ReturnType<typeof createMsCartService>['repository'];
  const tokens = new Map<string, string>();

  const token = async (principal: Principal) => {
    const key = `${principal.tipo}:${principal.id}:${principal.nombre}`;
    if (!tokens.has(key)) tokens.set(key, await signInternalPrincipal(principal, SECRET, 3600));
    return tokens.get(key)!;
  };
  const as = (principal: Principal) => ({
    get: async (path: string) => request(app).get(`/api/v3${path}`).set('x-internal-principal', await token(principal)),
    post: async (path: string, body: object, headers: Record<string, string> = {}) =>
      request(app).post(`/api/v3${path}`).set('x-internal-principal', await token(principal)).set(headers).send(body),
    patch: async (path: string, body: object) => request(app).patch(`/api/v3${path}`).set('x-internal-principal', await token(principal)).send(body),
    delete: async (path: string) => request(app).delete(`/api/v3${path}`).set('x-internal-principal', await token(principal)),
  });
  const order = as(servicePrincipal('order'));
  const startPayment = (cartId: number, itemId: number, orderNumber: string, key: string = randomUUID()) =>
    order.post(`/carritos/${cartId}/items/${itemId}/orden`, { external_order_id: orderNumber }, { 'Idempotency-Key': key });

  beforeAll(async () => {
    db = await freshDatabase();
    const config = { ...readMsCartConfig({ INTERNAL_TOKEN_SECRET: SECRET }), maxItems: MAX_ITEMS };
    ({ app, repository } = createMsCartService(config, db.dataSource, { lookups, now: () => NOW }));
  });
  afterAll(() => db.drop());

  describe('carrito del usuario', () => {
    const ana = as(user('usuario-ana'));

    it('sin carrito responde uno vacío', async () => {
      const res = await ana.get('/carrito');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: null, active: true, items: [], item_count: 0, ticket_count: 0 });
    });

    it('agrega un ítem (201 + Location) y guarda el ID público aunque llegue el slug', async () => {
      const res = await ana.post('/carrito/items', { attraction_id: 'quito-city-tour', slot_id: 'slot-20261125-1030', adult_count: 2, child_count: 1 });
      expect(res.status).toBe(201);
      const [item] = res.body.items;
      expect(res.headers.location).toBe(`/api/v3/carrito/items/${item.item_id}`);
      expect(item).toMatchObject({
        attraction_id: 'PRhu4UBTWPBC', slot_id: 'slot-20261125-1030', date: '2026-11-25', time: '10:30:00',
        adult_count: 2, child_count: 1, senior_count: 0, student_count: 0, infant_count: 0, ticket_count: 3, status: 'PENDIENTE', external_order_id: null,
      });
      expect(res.body).toMatchObject({ item_count: 1, ticket_count: 3 });
    });

    it('la misma atracción y turno reemplaza las cantidades (200)', async () => {
      const res = await ana.post('/carrito/items', { attraction_id: 'PRhu4UBTWPBC', slot_id: 'slot-20261125-1030', adult_count: 1, infant_count: 1 });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ adult_count: 1, child_count: 0, infant_count: 1 });
    });

    it('acepta una atracción sin turno', async () => {
      const res = await ana.post('/carrito/items', { attraction_id: 'BnosAventur1', adult_count: 1 });
      expect(res.status).toBe(201);
      expect(res.body.items.find((i: { attraction_id: string }) => i.attraction_id === 'BnosAventur1')).toMatchObject({ slot_id: null, date: null, time: null });
    });

    it.each([
      [{ attraction_id: 'NoExiste0000', adult_count: 1 }, 'ATTRACTION_NOT_FOUND'],
      [{ attraction_id: 'CuencaColon1', slot_id: 'slot-20261125-2300', adult_count: 1 }, 'SLOT_NOT_FOUND'],
      [{ attraction_id: 'CuencaColon1', slot_id: 'slot-20261025-0900', adult_count: 1 }, 'SLOT_IN_PAST'],
      [{ attraction_id: 'CuencaColon1', adult_count: 0 }, 'SEMANTIC_VALIDATION_FAILED'],
    ])('422 para %j', async (body, code) => {
      const res = await ana.post('/carrito/items', body);
      expect(res.status).toBe(422);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ status: 422, code });
    });

    it('400 para tipos erróneos', async () => {
      const res = await ana.post('/carrito/items', { attraction_id: 'CuencaColon1', adult_count: 'dos' });
      expect(res.status).toBe(400);
      expect(res.body.invalid_params).toEqual([{ name: 'adult_count', reason: 'Debe ser un número entero.' }]);
    });

    it('PATCH cambia solo lo enviado; un turno repetido es 409', async () => {
      const cart = (await ana.get('/carrito')).body;
      const sinTurno = cart.items.find((i: { attraction_id: string }) => i.attraction_id === 'BnosAventur1');
      const res = await ana.patch(`/carrito/items/${sinTurno.item_id}`, { slot_id: 'slot-20261127-0900', senior_count: 1 });
      expect(res.status).toBe(200);
      expect(res.body.items.find((i: { item_id: number }) => i.item_id === sinTurno.item_id)).toMatchObject({ slot_id: 'slot-20261127-0900', adult_count: 1, senior_count: 1 });

      await ana.post('/carrito/items', { attraction_id: 'BnosAventur1', slot_id: 'slot-20261128-0900', adult_count: 1 });
      const dup = await ana.patch(`/carrito/items/${sinTurno.item_id}`, { slot_id: 'slot-20261128-0900' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('CART_ITEM_DUPLICATE');
    });

    it('al llegar al tope responde 409 CART_FULL', async () => {
      expect((await ana.post('/carrito/items', { attraction_id: 'CuencaColon1', adult_count: 1 })).status).toBe(201);
      const res = await ana.post('/carrito/items', { attraction_id: 'GalapagosAA1', adult_count: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CART_FULL');
    });

    it('otro usuario no ve ni toca los ítems de Ana', async () => {
      const [item] = (await ana.get('/carrito')).body.items;
      const luis = as(user('usuario-luis'));
      expect((await luis.get('/carrito')).body.items).toEqual([]);
      expect((await luis.patch(`/carrito/items/${item.item_id}`, { adult_count: 3 })).status).toBe(404);
      expect((await luis.delete(`/carrito/items/${item.item_id}`)).status).toBe(404);
    });

    it('DELETE de un ítem y del carrito', async () => {
      const before = (await ana.get('/carrito')).body.items;
      const removed = await ana.delete(`/carrito/items/${before[0].item_id}`);
      expect(removed.status).toBe(200);
      expect(removed.body.items).toHaveLength(before.length - 1);
      const cleared = await ana.delete('/carrito');
      expect(cleared.body.items).toEqual([]);
      expect(cleared.body.id).not.toBeNull();
    });
  });

  describe('permisos', () => {
    it('un socio con X-API-Key o un servicio no usan /carrito', async () => {
      expect((await as(partner).get('/carrito')).status).toBe(403);
      expect((await order.get('/carrito')).status).toBe(403);
    });

    it('sin principal es 401', async () => {
      expect((await request(app).get('/api/v3/carrito')).status).toBe(401);
    });

    it('un usuario o un socio no usan las rutas de compra', async () => {
      expect((await as(user('usuario-ana')).get('/carritos/1/items/1')).status).toBe(403);
      expect((await as(partner).post('/carritos/1/items/1/orden', { external_order_id: 'ORD-X' }, { 'Idempotency-Key': randomUUID() })).status).toBe(403);
      expect((await as(servicePrincipal('booking')).get('/carritos/1/items/1')).status).toBe(403);
    });
  });

  describe('compra: cada atracción se paga por separado', () => {
    const sofia = as(user('usuario-sofia'));
    let cartId: number;
    let quito: number;
    let banos: number;
    let cuenca: number;

    beforeAll(async () => {
      await sofia.post('/carrito/items', { attraction_id: 'PRhu4UBTWPBC', slot_id: 'slot-20261125-1030', adult_count: 2 });
      await sofia.post('/carrito/items', { attraction_id: 'BnosAventur1', slot_id: 'slot-20261126-0900', adult_count: 1 });
      const cart = (await sofia.post('/carrito/items', { attraction_id: 'CuencaColon1', adult_count: 1 })).body;
      cartId = cart.id;
      [quito, banos, cuenca] = cart.items.map((i: { item_id: number }) => i.item_id);
    });

    it('Order lee el ítem que se va a pagar', async () => {
      const res = await order.get(`/carritos/${cartId}/items/${quito}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ attraction_id: 'PRhu4UBTWPBC', adult_count: 2, status: 'PENDIENTE' });
      expect((await order.get(`/carritos/${cartId}/items/999999`)).status).toBe(404);
    });

    it('pagar un ítem lo pasa a EN_PAGO; los demás siguen pendientes', async () => {
      const key = randomUUID();
      const res = await startPayment(cartId, quito, 'ORD-SOFIA-1', key);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'EN_PAGO', external_order_id: 'ORD-SOFIA-1' });

      const cart = (await sofia.get('/carrito')).body;
      expect(cart.items.map((i: { status: string }) => i.status)).toEqual(['EN_PAGO', 'PENDIENTE', 'PENDIENTE']);

      // Reintento idéntico: misma respuesta. Otra orden u otra clave: 409.
      expect((await startPayment(cartId, quito, 'ORD-SOFIA-1', key)).status).toBe(200);
      expect((await startPayment(cartId, quito, 'ORD-SOFIA-9', key)).body.code).toBe('CART_ITEM_ALREADY_ORDERED');
      expect((await startPayment(cartId, quito, 'ORD-SOFIA-1')).body.code).toBe('CART_ITEM_ALREADY_ORDERED');
    });

    it('un ítem en pago no se edita, no se quita y sobrevive a vaciar el carrito', async () => {
      expect((await sofia.patch(`/carrito/items/${quito}`, { adult_count: 3 })).body.code).toBe('CART_ITEM_IN_PAYMENT');
      expect((await sofia.delete(`/carrito/items/${quito}`)).body.code).toBe('CART_ITEM_IN_PAYMENT');
      const again = await sofia.post('/carrito/items', { attraction_id: 'PRhu4UBTWPBC', slot_id: 'slot-20261125-1030', adult_count: 1 });
      expect(again.body.code).toBe('CART_ITEM_IN_PAYMENT');
    });

    it('una orden no se liga a dos ítems', async () => {
      const res = await startPayment(cartId, banos, 'ORD-SOFIA-1');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ORDER_ALREADY_LINKED');
    });

    it('sin turno no se puede pagar; sin Idempotency-Key es 400', async () => {
      expect((await startPayment(cartId, cuenca, 'ORD-SOFIA-2')).body.code).toBe('SLOT_REQUIRED');
      const res = await order.post(`/carritos/${cartId}/items/${banos}/orden`, { external_order_id: 'ORD-SOFIA-3' });
      expect(res.status).toBe(400);
    });

    it('con el pago aprobado el ítem queda COMPRADO y sale del carrito', async () => {
      expect((await order.post(`/carritos/${cartId}/items/${banos}/orden/confirmacion`, { external_order_id: 'ORD-X' })).body.code).toBe('CART_ITEM_NOT_IN_PAYMENT');

      const res = await order.post(`/carritos/${cartId}/items/${quito}/orden/confirmacion`, { external_order_id: 'ORD-SOFIA-1' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('COMPRADO');
      expect((await order.post(`/carritos/${cartId}/items/${quito}/orden/confirmacion`, { external_order_id: 'ORD-SOFIA-1' })).status).toBe(200);

      const cart = (await sofia.get('/carrito')).body;
      expect(cart.active).toBe(true);
      expect(cart.items.map((i: { item_id: number }) => i.item_id)).toEqual([banos, cuenca]);
      expect((await order.post(`/carritos/${cartId}/items/${quito}/orden/liberacion`, { external_order_id: 'ORD-SOFIA-1' })).body.code).toBe('CART_ITEM_ALREADY_ORDERED');
    });

    it('la misma atracción y turno se pueden volver a agregar después de comprarla', async () => {
      const res = await sofia.post('/carrito/items', { attraction_id: 'PRhu4UBTWPBC', slot_id: 'slot-20261125-1030', adult_count: 1 });
      expect(res.status).toBe(201);
    });

    it('con el pago rechazado el ítem vuelve a PENDIENTE y se puede pagar con otra orden', async () => {
      await startPayment(cartId, banos, 'ORD-SOFIA-4');
      const released = await order.post(`/carritos/${cartId}/items/${banos}/orden/liberacion`, { external_order_id: 'ORD-SOFIA-4' });
      expect(released.status).toBe(200);
      expect(released.body).toMatchObject({ status: 'PENDIENTE', external_order_id: null });
      expect((await order.post(`/carritos/${cartId}/items/${banos}/orden/liberacion`, { external_order_id: 'ORD-SOFIA-4' })).status).toBe(200);
      expect((await startPayment(cartId, banos, 'ORD-SOFIA-5')).body.status).toBe('EN_PAGO');
    });

    it('vaciar el carrito conserva los ítems en pago', async () => {
      const cart = (await sofia.delete('/carrito')).body;
      expect(cart.items).toEqual([expect.objectContaining({ item_id: banos, status: 'EN_PAGO' })]);
    });
  });

  describe('carritos abandonados', () => {
    it('se desactivan los carritos viejos sin ítems en pago', async () => {
      const viejo = as(user('usuario-viejo'));
      const conPago = as(user('usuario-con-pago'));
      await viejo.post('/carrito/items', { attraction_id: 'MindoNublad1', adult_count: 1 });
      const pagando = (await conPago.post('/carrito/items', { attraction_id: 'MindoNublad1', slot_id: 'slot-20261201-0800', adult_count: 1 })).body;
      await startPayment(pagando.id, pagando.items[0].item_id, 'ORD-VIEJO-1');

      // El trigger renueva car_actualizado_en en cada UPDATE: se apaga para fechar los carritos en el pasado.
      await db.dataSource.query(`ALTER TABLE carrito DISABLE TRIGGER trg_carrito_actualizado`);
      await db.dataSource.query(`UPDATE carrito SET car_actualizado_en = now() - interval '40 days' WHERE usu_id IN ('usuario-viejo', 'usuario-con-pago')`);
      await db.dataSource.query(`ALTER TABLE carrito ENABLE TRIGGER trg_carrito_actualizado`);

      expect(await repository.abandonIdle(30)).toBe(1);
      expect((await viejo.get('/carrito')).body.id).toBeNull();
      expect((await conPago.get('/carrito')).body.id).toBe(pagando.id);
    });
  });

  it('GET /api/v3/health y /health', async () => {
    expect((await request(app).get('/api/v3/health')).body).toMatchObject({ status: 'UP', service: 'ms-cart', database_connected: true });
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
