import { randomUUID } from 'node:crypto';
import { addDays, todayIn } from '@atracciones/platform';
import request from 'supertest';
import { CEDULA, tomorrow } from './booking-flow';
import { startSystem, userToken, type System } from './harness';

/** Fase 7 (plan §8): el portal sobre GraphQL (catálogo, cuenta, compra, carrito, soporte y administración). */
describe('Fase 7 — GraphQL del portal', () => {
  let system: System;
  let cliente: string;
  let admin: string;

  const gql = async (query: string, variables: Record<string, unknown> = {}, token?: string) => {
    const req = request(system.gatewayUrl).post('/graphql').send({ query, variables });
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };
  /** Ejecuta y exige que no haya errores. */
  const data = async (query: string, variables: Record<string, unknown> = {}, token?: string) => {
    const res = await gql(query, variables, token);
    if (res.body.errors) throw new Error(JSON.stringify(res.body.errors));
    return res.body.data;
  };
  const firstError = async (query: string, variables: Record<string, unknown> = {}, token?: string) => {
    const res = await gql(query, variables, token);
    expect(res.body.errors).toBeDefined();
    return res.body.errors[0];
  };

  const customer = { fullName: 'Paúl Rosero', email: 'paul.rosero@epn.edu.ec', phone: '0991234567', documentType: 'CEDULA', documentId: CEDULA };
  const PURCHASE = /* GraphQL */ `
    mutation ($input: PurchaseInput!, $key: ID!) {
      purchase(input: $input, idempotencyKey: $key) {
        reservation { id code status externalOrderId ticketCount total { amount currency } attraction { name } canCancel guide voucher }
        order { externalOrderId status paymentMethod total { amount } payments { method status amount { amount } } lines { tickets { type quantity unitPrice } } }
      }
    }`;
  const purchaseInput = (overrides: Record<string, unknown> = {}) => ({
    attractionId: 'PRhu4UBTWPBC', date: tomorrow(), time: '10:30', tickets: [{ type: 'ADULT', quantity: 2 }, { type: 'CHILD', quantity: 1 }],
    customer, paymentMethod: 'TARJETA_CREDITO', ...overrides,
  });

  beforeAll(async () => {
    system = await startSystem({ portal: true });
    cliente = await userToken(system, 'cliente.portal@test.ec', ['cliente']);
    admin = await userToken(system, 'admin.portal@test.ec', ['admin']);
  });
  afterAll(async () => {
    await system?.close();
  });

  describe('catálogo público (sin sesión)', () => {
    it('lista categorías, atracciones con tarifa y el detalle con itinerario y disponibilidad', async () => {
      const d = await data(`{
        categories { id name children { id } }
        attractions(limit: 5) { total items { id name city priceFrom { amount currency } tariff { adult child } rating { score } isFavorite } }
        attraction(id: "PRhu4UBTWPBC") { slug description languages itinerary { stop time title } meetingPoint { latitude longitude googleMapsUrl } provider { name } }
        availability(attractionId: "PRhu4UBTWPBC", date: "${tomorrow()}") { slotId time label available status adultPrice }
      }`);
      expect(d.categories.length).toBeGreaterThan(0);
      expect(d.attractions.total).toBeGreaterThan(0);
      const quito = d.attractions.items.find((a: { id: string }) => a.id === 'PRhu4UBTWPBC');
      expect(quito).toEqual(expect.objectContaining({ priceFrom: { amount: 30, currency: 'USD' }, isFavorite: false }));
      expect(d.attraction.itinerary.length).toBeGreaterThan(0);
      expect(d.attraction.meetingPoint.latitude).toEqual(expect.any(Number));
      expect(d.availability).toContainEqual(expect.objectContaining({ slotId: `slot-${tomorrow().replace(/-/g, '')}-1030`, time: '10:30', label: '10:30 a.m.', status: 'DISPONIBLE' }));
    });

    it('rechaza consultas demasiado profundas y operaciones de cuenta sin sesión', async () => {
      const deep = await gql(`{ myOrders { items { reservation { order { reservation { order { reservation { order { id } } } } } } } } }`);
      expect(deep.status).toBe(400);
      expect(deep.body.errors[0].extensions.reason).toBe('QUERY_TOO_DEEP');
      // Cada lista multiplica el costo de sus hijos por su `limit`: seis listas de 100 reservas con 5 niveles ≈ 3000 > 2500.
      const list = (alias: string) => `${alias}: myReservations(limit: 100) { items { order { payments { refunds { code } } } } }`;
      const complex = await gql(`{ ${['a', 'b', 'c', 'd', 'e', 'f'].map(list).join(' ')} }`);
      expect(complex.status).toBe(400);
      expect(complex.body.errors[0].extensions.reason).toBe('QUERY_TOO_COMPLEX');
      const anonymous = await firstError('{ myReservations { total } }');
      expect(anonymous.extensions).toEqual(expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401, correlationId: expect.any(String) }));
    });
  });

  describe('cuenta, compra y cancelación', () => {
    it('el perfil y los datos de facturación validan el documento', async () => {
      const me = (await data('{ me { email fullName roles scopes } }', {}, cliente)).me;
      expect(me).toEqual(expect.objectContaining({ email: 'cliente.portal@test.ec', roles: ['cliente'], scopes: expect.arrayContaining(['attractions:book']) }));
      const SAVE = 'mutation ($input: BillingInput!) { saveBilling(input: $input) { documentType documentId legalName } }';
      const invalid = await firstError(SAVE, { input: { documentType: 'CEDULA', documentId: '1723456789', legalName: 'Paúl Rosero', email: 'paul@test.ec' } }, cliente);
      expect(invalid.extensions).toEqual(expect.objectContaining({ code: 'BAD_USER_INPUT', invalidParams: [expect.objectContaining({ name: 'numero_documento' })] }));
      const saved = await data(SAVE, { input: { documentType: 'CEDULA', documentId: CEDULA, legalName: 'Paúl Rosero', email: 'paul@test.ec' } }, cliente);
      expect(saved.saveBilling).toEqual({ documentType: 'CEDULA', documentId: CEDULA, legalName: 'Paúl Rosero' });
    });

    it('compra por la saga de Order, es idempotente y deja la orden con pago, líneas y factura', async () => {
      const key = randomUUID();
      // Dentro de tres días el plazo de cancelación gratuita (24 h antes) sigue abierto.
      const input = purchaseInput({ date: addDays(todayIn('America/Guayaquil'), 3) });
      const first = (await data(PURCHASE, { input, key }, cliente)).purchase;
      expect(first.reservation).toEqual(expect.objectContaining({ status: 'CONFIRMED', code: expect.stringMatching(/^DEC-/), ticketCount: 3, total: { amount: 75, currency: 'USD' }, canCancel: true }));
      expect(first.order).toEqual(expect.objectContaining({ status: 'CONFIRMADA', paymentMethod: 'TARJETA_CREDITO', total: { amount: 75 } }));
      expect(first.order.payments).toEqual([{ method: 'TARJETA_CREDITO', status: 'APROBADO', amount: { amount: 75 } }]);
      expect(first.order.lines[0].tickets).toEqual([{ type: 'ADULT', quantity: 2, unitPrice: 30 }, { type: 'CHILD', quantity: 1, unitPrice: 15 }]);

      const replay = (await data(PURCHASE, { input, key }, cliente)).purchase;
      expect(replay.reservation.id).toBe(first.reservation.id);

      await system.pumpEvents();
      const order = (await data(`query ($id: ID!) { order(id: $id) { invoices { type status total } reservation { code } } }`, { id: first.reservation.externalOrderId }, cliente)).order;
      expect(order.invoices).toEqual([{ type: 'FACTURA', status: 'AUTORIZADA', total: 75 }]);
      expect(order.reservation.code).toBe(first.reservation.code);

      const mine = (await data('{ myReservations { total items { code } } myOrders { total items { externalOrderId status } } }', {}, cliente));
      expect(mine.myReservations.items.map((r: { code: string }) => r.code)).toContain(first.reservation.code);
      expect(mine.myOrders.items).toContainEqual({ externalOrderId: first.reservation.externalOrderId, status: 'CONFIRMADA' });
    });

    it('valida al titular y devuelve los errores de negocio de la saga con su código', async () => {
      const invalid = await firstError(PURCHASE, { input: purchaseInput({ customer: { ...customer, documentId: '1723456789' } }), key: randomUUID() }, cliente);
      expect(invalid.extensions).toEqual(expect.objectContaining({ code: 'BAD_USER_INPUT', reason: 'INVALID_DOCUMENT' }));
      // Quito panorámico: 8 cupos a las 14:00.
      const noSeats = await firstError(PURCHASE, { input: purchaseInput({ attractionId: 'QTOPANORAM10', tickets: [{ type: 'ADULT', quantity: 9 }], time: '14:00' }), key: randomUUID() }, cliente);
      expect(noSeats.extensions).toEqual(expect.objectContaining({ code: 'CONFLICT', status: 409, reason: 'OUT_OF_STOCK' }));
      const noSlot = await firstError(PURCHASE, { input: purchaseInput({ time: '15:00' }), key: randomUUID() }, cliente);
      expect(noSlot.extensions).toEqual(expect.objectContaining({ status: 422, reason: 'SLOT_MISMATCH' }));
    });

    it('cancela con reembolso y otra persona no puede ver la reserva', async () => {
      const bought = (await data(PURCHASE, { input: purchaseInput({ date: addDays(todayIn('America/Guayaquil'), 3), tickets: [{ type: 'ADULT', quantity: 1 }] }), key: randomUUID() }, cliente)).purchase;
      const otro = await userToken(system, 'otro.cliente@test.ec', ['cliente']);
      expect((await data('query ($id: ID!) { reservation(id: $id) { id } }', { id: bought.reservation.id }, otro)).reservation).toBeNull();

      const cancelled = (await data('mutation ($id: ID!, $key: ID!) { cancelReservation(id: $id, reason: "Cambio de planes", idempotencyKey: $key) { status refundCode refundedAmount cancellationReason } }',
        { id: bought.reservation.id, key: randomUUID() }, cliente)).cancelReservation;
      expect(cancelled).toEqual({ status: 'CANCELLED', refundCode: expect.stringMatching(/^REF-ATR-/), refundedAmount: 30, cancellationReason: 'Cambio de planes' });
    });
  });

  describe('carrito y favoritos', () => {
    it('agrega turnos, estima el total, compra todo el carrito y lo vacía', async () => {
      const ADD = 'mutation ($input: CartItemInput!) { addToCart(input: $input) { items { id attractionId ticketCount available subtotal { amount } } total { amount } } }';
      const day = addDays(todayIn('America/Guayaquil'), 4);
      await data(ADD, { input: { attractionId: 'PRhu4UBTWPBC', date: day, time: '10:30', tickets: [{ type: 'ADULT', quantity: 1 }] } }, cliente);
      const cart = (await data(ADD, { input: { attractionId: 'PRhu4UBTWPBC', date: day, time: '14:00', tickets: [{ type: 'ADULT', quantity: 1 }, { type: 'CHILD', quantity: 2 }] } }, cliente)).addToCart;
      expect(cart.items).toHaveLength(2);
      expect(cart.total.amount).toBe(30 + 30 + 2 * 15);
      expect(cart.items.every((i: { available: boolean }) => i.available)).toBe(true);

      const missing = await firstError(ADD, { input: { attractionId: 'PRhu4UBTWPBC', date: day, time: '03:00', tickets: [{ type: 'ADULT', quantity: 1 }] } }, cliente);
      expect(missing.extensions.reason).toBe('SLOT_NOT_FOUND');

      const results = (await data('mutation ($c: CustomerInput!, $key: ID!) { checkoutCart(customer: $c, paymentMethod: PAGO_EN_SITIO, idempotencyKey: $key) { itemId reservation { status } error { code } } }',
        { c: customer, key: randomUUID() }, cliente)).checkoutCart;
      expect(results).toHaveLength(2);
      expect(results.every((r: { reservation: { status: string } | null }) => r.reservation?.status === 'CONFIRMED')).toBe(true);
      expect((await data('{ cart { items { id } total { amount } } }', {}, cliente)).cart).toEqual({ items: [], total: { amount: 0 } });
    });

    it('marca y quita favoritos', async () => {
      const added = (await data('mutation { addFavorite(attractionId: "PRhu4UBTWPBC") { id isFavorite } }', {}, cliente)).addFavorite;
      expect(added).toEqual([{ id: 'PRhu4UBTWPBC', isFavorite: true }]);
      expect((await data('{ attraction(id: "PRhu4UBTWPBC") { isFavorite } }', {}, cliente)).attraction.isFavorite).toBe(true);
      expect((await data('mutation { removeFavorite(attractionId: "PRhu4UBTWPBC") { id } }', {}, cliente)).removeFavorite).toEqual([]);
    });
  });

  describe('soporte y administración', () => {
    it('un mensaje de contacto anónimo llega a la bandeja de la administración', async () => {
      const sent = (await data('mutation ($i: ContactInput!) { sendContactMessage(input: $i) { id status } }',
        { i: { name: 'Ana Pérez', email: 'ana@test.ec', subject: 'Grupo escolar', message: 'Quisiera cotizar una visita para 30 estudiantes.' } })).sendContactMessage;
      expect(sent.status).toBe('NUEVO');
      const inbox = (await data('{ contactMessages { total items { id subject } } }', {}, admin)).contactMessages;
      expect(inbox.items).toContainEqual({ id: sent.id, subject: 'Grupo escolar' });
      const answered = (await data(`mutation { setContactMessageStatus(id: "${sent.id}", status: RESPONDIDO) { status respondedAt } }`, {}, admin)).setContactMessageStatus;
      expect(answered).toEqual({ status: 'RESPONDIDO', respondedAt: expect.any(String) });
    });

    it('las consultas administrativas exigen el rol admin', async () => {
      const forbidden = await firstError('{ adminDashboard { attractions } }', {}, cliente);
      expect(forbidden.extensions).toEqual(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
    });

    it('tablero, usuarios, reservas con su dueño, ventas, bitácora y salud de los servicios', async () => {
      await system.pumpEvents();
      const d = await data(`{
        adminDashboard { attractions activeAttractions users reservationsByStatus { key count } revenue { amount } upcoming { slots capacity reserved } }
        adminUsers(search: "cliente.portal") { total items { email roles status } }
        adminRoles { name users }
        adminReservations(limit: 50) { total items { code owner { email } attraction { name } } }
        adminOrders(status: CONFIRMADA) { total items { externalOrderId owner { email } } }
        adminPayments { total items { method status order { externalOrderId } } }
        salesReport { revenue orders byAttraction { attractionId attraction { name } revenue } byMethod { method orders } }
        auditLog(eventType: "ReservaEmitida") { total items { eventType service correlationId } }
        systemHealth { status services { service status } }
      }`, {}, admin);
      expect(d.adminDashboard.activeAttractions).toBeGreaterThan(0);
      expect(d.adminDashboard.reservationsByStatus).toContainEqual(expect.objectContaining({ key: 'CONFIRMED' }));
      expect(d.adminDashboard.revenue.amount).toBeGreaterThan(0);
      expect(d.adminUsers.items).toEqual([{ email: 'cliente.portal@test.ec', roles: ['cliente'], status: 'ACTIVO' }]);
      expect(d.adminRoles.find((r: { name: string }) => r.name === 'admin').users).toBeGreaterThanOrEqual(1);
      expect(d.adminReservations.items.some((r: { owner: { email: string } | null }) => r.owner?.email === 'cliente.portal@test.ec')).toBe(true);
      expect(d.adminOrders.total).toBeGreaterThan(0);
      expect(d.adminPayments.items[0].order.externalOrderId).toMatch(/^ORD-/);
      expect(d.salesReport.revenue).toBeGreaterThan(0);
      expect(d.salesReport.byMethod.map((m: { method: string }) => m.method)).toEqual(expect.arrayContaining(['TARJETA_CREDITO', 'PAGO_EN_SITIO']));
      expect(d.auditLog.total).toBeGreaterThan(0);
      expect(d.systemHealth.services.map((s: { service: string }) => s.service)).toEqual(['identity', 'catalog', 'inventory', 'cart', 'order', 'booking', 'payment', 'invoicing', 'audit']);
      // Con más de 1 GB de memoria un servicio informa DEGRADED (el arnés corre todo en un solo proceso).
      expect(d.systemHealth.services.every((s: { status: string }) => s.status === 'UP' || s.status === 'DEGRADED')).toBe(true);
    });

    it('crea una atracción con tarifa y turnos, aparece en el catálogo y se puede comprar', async () => {
      const refs = (await data('{ catalogReferences { cities { id name } categories { id } languages { code } } }', {}, admin)).catalogReferences;
      const input = {
        name: 'Ruta del Cacao en Mindo', shortDescription: 'Recorrido por una finca cacaotera con degustación.',
        description: 'Visita guiada a una finca de cacao fino de aroma en Mindo, con proceso del grano a la barra y degustación.',
        categoryId: refs.categories[0].id, cityId: refs.cities[0].id, durationHours: 3, includesGuide: true,
        meetingPoint: { address: 'Calle principal de Mindo, junto al parque', latitude: -0.0526, longitude: -78.7745 },
        freeCancellation: true, cancellationHours: 24, languages: [refs.languages[0].code], inclusions: ['Degustación'], photos: ['https://example.com/cacao.jpg'],
        itinerary: [{ time: '09:00', title: 'Bienvenida', durationMinutes: 30 }],
      };
      const created = (await data('mutation ($i: AttractionInput!) { createAttraction(input: $i) { id slug active } }', { i: input }, admin)).createAttraction;
      expect(created).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9]{12}$/), slug: 'ruta-del-cacao-en-mindo', active: true });

      const tariff = (await data(`mutation { setTariff(attractionId: "${created.id}", input: { adult: 25, child: 12.5, senior: 18, infant: 0 }) { adult child student } }`, {}, admin)).setTariff;
      expect(tariff).toEqual({ adult: 25, child: 12.5, student: null });
      const day = addDays(todayIn('America/Guayaquil'), 5);
      const slots = (await data(`mutation { upsertSlots(input: { attractionId: "${created.id}", from: "${day}", to: "${addDays(day, 1)}", times: ["09:00", "14:00"], capacity: 2 }) { created updated } }`, {}, admin)).upsertSlots;
      expect(slots).toEqual({ created: 4, updated: 0 });

      await system.pumpEvents();
      const search = (await data('query ($q: String) { attractions(filter: { query: $q }) { items { id priceFrom { amount } } } }', { q: 'Cacao' })).attractions;
      expect(search.items).toEqual([{ id: created.id, priceFrom: { amount: 25 } }]);

      const bought = (await data(PURCHASE, { input: purchaseInput({ attractionId: created.slug, date: day, time: '09:00', tickets: [{ type: 'ADULT', quantity: 2 }] }), key: randomUUID() }, cliente)).purchase;
      expect(bought.reservation).toEqual(expect.objectContaining({ status: 'CONFIRMED', total: { amount: 50, currency: 'USD' } }));
      // El stock del turno nuevo llegó a Booking (StreamInventoryChanges) y la venta también (PushStockUpdate).
      await system.pumpEvents();
      expect(system.bookingMock!.received.pushes).toContainEqual(expect.objectContaining({ item_id: created.id, available_units: 0 }));

      const below = await firstError(`mutation { setSlotCapacity(attractionId: "${created.id}", date: "${day}", time: "09:00", capacity: 1) { capacity } }`, {}, admin);
      expect(below.extensions).toEqual(expect.objectContaining({ code: 'CONFLICT', reason: 'CAPACITY_BELOW_SOLD' }));

      const off = (await data(`mutation { setAttractionActive(id: "${created.id}", active: false) { active } }`, {}, admin)).setAttractionActive;
      expect(off.active).toBe(false);
      expect((await data(`{ attraction(id: "${created.id}") { id } }`)).attraction).toBeNull();
    });

    it('la administración cancela sin plazo y con reembolso total', async () => {
      const bought = (await data(PURCHASE, { input: purchaseInput({ tickets: [{ type: 'ADULT', quantity: 1 }] }), key: randomUUID() }, cliente)).purchase;
      const cancelled = (await data('mutation ($id: ID!, $key: ID!) { adminCancelReservation(id: $id, reason: "Cierre por lluvia", idempotencyKey: $key) { status refundedAmount } }',
        { id: bought.reservation.code, key: randomUUID() }, admin)).adminCancelReservation;
      expect(cancelled).toEqual({ status: 'CANCELLED', refundedAmount: 30 });
    });
  });
});
