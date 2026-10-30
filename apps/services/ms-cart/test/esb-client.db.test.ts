process.env.LOG_SILENT = 'true';

import { randomUUID } from 'node:crypto';
import { AppError, asService, EsbClient, listen, runWithContext, signInternalPrincipal, type RunningServer } from '@atracciones/platform';
import { CartClient, createMsCartService, MS_CART_ROUTES, readMsCartConfig, type CartLookups } from '../src';
import { freshDatabase, type TestDatabase } from './database';
import { fakeEsb } from './fake-esb';

const SECRET = 'secreto-interno-de-pruebas-con-32-caracteres-o-mas';
const NOW = new Date('2026-10-25T15:00:00Z');
const lookups: CartLookups = {
  attractionCode: async (id) => (/^[A-Za-z0-9]{12}$/.test(id) ? id : null),
  slotOnSale: async () => true,
};

/** Código de un AppError recibido por el cliente (el ESB lo reconstruye a partir del ProblemDetails). */
const failure = async (work: Promise<unknown>) => {
  try {
    await work;
    return null;
  } catch (error) {
    return error instanceof AppError ? `${error.status} ${error.code}` : String(error);
  }
};

describe('CartClient → ESB → ms_cart', () => {
  let db: TestDatabase;
  let cartServer: RunningServer;
  let esbServer: RunningServer;
  let client: CartClient;
  let userToken: string;

  /** Como GraphQL: dentro del contexto de la petición del usuario. */
  const asUser = <T>(work: () => Promise<T>) => runWithContext({ correlationId: `cid-${randomUUID()}`, principalToken: userToken }, work);
  /** Como Order: con su cuenta de servicio. */
  const asOrder = <T>(work: () => Promise<T>) => asService('order', SECRET, work);

  beforeAll(async () => {
    db = await freshDatabase();
    const { app } = createMsCartService(readMsCartConfig({ INTERNAL_TOKEN_SECRET: SECRET }), db.dataSource, { lookups, now: () => NOW });
    cartServer = await listen(app, 0, '127.0.0.1');
    esbServer = await listen(fakeEsb(MS_CART_ROUTES, { cart: cartServer.url }), 0, '127.0.0.1');
    client = new CartClient(new EsbClient(esbServer.url, 5000));
    userToken = await signInternalPrincipal({ tipo: 'USUARIO', id: 'usuario-esb', scopes: ['attractions:read'] }, SECRET, 3600);
  });
  afterAll(async () => {
    await esbServer?.close();
    await cartServer?.close();
    await db?.drop();
  });

  it('health llega por el ESB', async () => {
    expect(await client.health()).toMatchObject({ status: 'UP', service: 'ms-cart' });
  });

  it('el usuario arma su carrito: agregar, cambiar, quitar y vaciar', async () => {
    const empty = await asUser(() => client.getCart());
    expect(empty).toMatchObject({ id: null, items: [] });

    let cart = await asUser(() => client.addItem({ attraction_id: 'PRhu4UBTWPBC', slot_id: 'slot-20261125-1030', adult_count: 2 }));
    cart = await asUser(() => client.addItem({ attraction_id: 'BnosAventur1', adult_count: 1 }));
    expect(cart.items.map((i) => i.attraction_id)).toEqual(['PRhu4UBTWPBC', 'BnosAventur1']);

    const banos = cart.items[1].item_id;
    cart = await asUser(() => client.updateItem(banos, { slot_id: 'slot-20261126-0900', child_count: 1 }));
    expect(cart.items[1]).toMatchObject({ slot_id: 'slot-20261126-0900', adult_count: 1, child_count: 1, ticket_count: 2 });

    cart = await asUser(() => client.removeItem(banos));
    expect(cart.items).toHaveLength(1);

    // Los errores del servicio llegan con su estado y código.
    expect(await failure(asUser(() => client.removeItem(banos)))).toBe('404 CART_ITEM_NOT_FOUND');
    expect(await failure(asUser(() => client.addItem({ attraction_id: 'PRhu4UBTWPBC', adult_count: 0 })))).toBe('422 SEMANTIC_VALIDATION_FAILED');
  });

  it('sin el principal del usuario el servicio responde 401', async () => {
    expect(await failure(client.getCart())).toBe('401 UNAUTHORIZED');
  });

  it('Order paga un ítem: la Idempotency-Key y la cuenta de servicio cruzan el ESB', async () => {
    const cart = await asUser(() => client.addItem({ attraction_id: 'CuencaColon1', slot_id: 'slot-20261127-1100', adult_count: 1 }));
    const cartId = cart.id!;
    const [quito, cuenca] = cart.items.map((i) => i.item_id);
    const key = randomUUID();

    expect(await asOrder(() => client.getItem(cartId, quito))).toMatchObject({ attraction_id: 'PRhu4UBTWPBC', status: 'PENDIENTE' });
    expect(await asOrder(() => client.startItemPayment(cartId, quito, 'ORD-ESB-1', key))).toMatchObject({ status: 'EN_PAGO', external_order_id: 'ORD-ESB-1' });
    // Mismo reintento: igual. Otra clave: la clave llegó al servicio y la rechaza.
    expect((await asOrder(() => client.startItemPayment(cartId, quito, 'ORD-ESB-1', key))).status).toBe('EN_PAGO');
    expect(await failure(asOrder(() => client.startItemPayment(cartId, quito, 'ORD-ESB-1', randomUUID())))).toBe('409 CART_ITEM_ALREADY_ORDERED');

    // El usuario no puede tocar el ítem en pago ni usar las rutas de Order.
    expect(await failure(asUser(() => client.updateItem(quito, { adult_count: 3 })))).toBe('409 CART_ITEM_IN_PAYMENT');
    expect(await failure(asUser(() => client.getItem(cartId, quito)))).toBe('403 FORBIDDEN');

    expect((await asOrder(() => client.confirmItemPurchase(cartId, quito, 'ORD-ESB-1'))).status).toBe('COMPRADO');
    const after = await asUser(() => client.getCart());
    expect(after.items.map((i) => i.item_id)).toEqual([cuenca]);

    // Pago rechazado en otro ítem: vuelve a PENDIENTE.
    await asOrder(() => client.startItemPayment(cartId, cuenca, 'ORD-ESB-2', randomUUID()));
    expect(await asOrder(() => client.releaseItemPayment(cartId, cuenca, 'ORD-ESB-2'))).toMatchObject({ status: 'PENDIENTE', external_order_id: null });
  });

  it('clear conserva los ítems en pago', async () => {
    const cart = await asUser(() => client.getCart());
    const [cuenca] = cart.items;
    await asOrder(() => client.startItemPayment(cart.id!, cuenca.item_id, 'ORD-ESB-3', randomUUID()));
    await asUser(() => client.addItem({ attraction_id: 'GalapagosAA1', adult_count: 1 }));
    const cleared = await asUser(() => client.clear());
    expect(cleared.items).toEqual([expect.objectContaining({ item_id: cuenca.item_id, status: 'EN_PAGO' })]);
  });
});
