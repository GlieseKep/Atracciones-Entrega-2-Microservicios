import { randomUUID } from 'node:crypto';
import { IdempotencyStore, type Principal } from '@atracciones/platform';
import { migratedDatabase, type ServiceDatabase } from './helpers';

describe('idempotencia por Idempotency-Key (platform)', () => {
  let db: ServiceDatabase;
  let store: IdempotencyStore;
  const booking: Principal = { tipo: 'API_CLIENTE', id: randomUUID(), scopes: [] };

  beforeAll(async () => {
    db = await migratedDatabase('order');
    store = new IdempotencyStore(db.dataSource);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it('repite el estado y el cuerpo guardados, incluido un 409', async () => {
    const key = randomUUID();
    const first = await store.begin(booking, 'create-reservation', key, { atraccion_id: 'PRhu4UBTWPBC', adult_count: 2 });
    if (!('recordId' in first)) throw new Error('se esperaba un registro nuevo');
    await store.complete(first.recordId, { status: 409, body: { code: 'OUT_OF_STOCK' } });

    // Mismo cuerpo con las claves en otro orden: es la misma solicitud.
    const again = await store.begin(booking, 'create-reservation', key, { adult_count: 2, atraccion_id: 'PRhu4UBTWPBC' });
    expect(again).toEqual({ replay: { status: 409, body: { code: 'OUT_OF_STOCK' } } });
  });

  it('rechaza la misma clave con otro cuerpo y mientras sigue en proceso', async () => {
    const key = randomUUID();
    await store.begin(booking, 'create-reservation', key, { adult_count: 1 });
    await expect(store.begin(booking, 'create-reservation', key, { adult_count: 1 })).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' });
    await expect(store.begin(booking, 'create-reservation', key, { adult_count: 3 })).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('tras un fallo técnico se puede reintentar con la misma clave', async () => {
    const key = randomUUID();
    const first = await store.begin(booking, 'create-reservation', key, { adult_count: 1 });
    if (!('recordId' in first)) throw new Error('se esperaba un registro nuevo');
    await store.abandon(first.recordId);
    expect(await store.begin(booking, 'create-reservation', key, { adult_count: 1 })).toEqual({ recordId: expect.any(String) });
  });

  it('la misma clave de otro principal u otra operación es independiente', async () => {
    const key = randomUUID();
    await store.begin(booking, 'create-reservation', key, {});
    expect(await store.begin({ ...booking, id: randomUUID() }, 'create-reservation', key, {})).toEqual({ recordId: expect.any(String) });
    expect(await store.begin(booking, 'cancel-reservation', key, {})).toEqual({ recordId: expect.any(String) });
  });
});
