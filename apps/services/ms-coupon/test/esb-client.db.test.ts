process.env.LOG_SILENT = 'true';

import { randomUUID } from 'node:crypto';
import { AppError, asService, EsbClient, listen, runWithContext, signInternalPrincipal, type Principal, type RunningServer } from '@atracciones/platform';
import { CouponClient, createMsCouponService, MS_COUPON_ROUTES, readMsCouponConfig, type CityDirectory } from '../src';
import { freshDatabase, type TestDatabase } from './database';
import { fakeEsb } from './fake-esb';

const SECRET = 'secreto-interno-de-pruebas-con-32-caracteres-o-mas';
const cities: CityDirectory = { cities: async () => [{ id: 1, name: 'Quito' }, { id: 2, name: 'Baños' }] };

const failure = async (work: Promise<unknown>) => {
  try {
    await work;
    return null;
  } catch (error) {
    return error instanceof AppError ? `${error.status} ${error.code}` : String(error);
  }
};

describe('CouponClient → ESB → ms_coupon', () => {
  let db: TestDatabase;
  let couponServer: RunningServer;
  let esbServer: RunningServer;
  let client: CouponClient;
  const tokens: Record<string, string> = {};

  const within = <T>(who: string, work: () => Promise<T>) => runWithContext({ correlationId: `cid-${randomUUID()}`, principalToken: tokens[who] }, work);

  beforeAll(async () => {
    db = await freshDatabase();
    const { app } = createMsCouponService(readMsCouponConfig({ INTERNAL_TOKEN_SECRET: SECRET }), db.dataSource, { cities, now: () => new Date('2026-10-25T15:00:00Z') });
    couponServer = await listen(app, 0, '127.0.0.1');
    esbServer = await listen(fakeEsb(MS_COUPON_ROUTES, { coupon: couponServer.url }), 0, '127.0.0.1');
    client = new CouponClient(new EsbClient(esbServer.url, 5000));
    const principals: Record<string, Principal> = {
      admin: { tipo: 'USUARIO', id: randomUUID(), scopes: ['attractions:write', 'promotions:read', 'promotions:write'] },
      partner: { tipo: 'API_CLIENTE', id: randomUUID(), scopes: ['promotions:read'], nombre: 'Booking Prototipo' },
      cliente: { tipo: 'USUARIO', id: randomUUID(), scopes: ['attractions:read'] },
    };
    for (const [name, p] of Object.entries(principals)) tokens[name] = await signInternalPrincipal(p, SECRET, 3600);
  });
  afterAll(async () => {
    await esbServer?.close();
    await couponServer?.close();
    await db?.drop();
  });

  it('health llega por el ESB', async () => {
    expect(await client.health()).toMatchObject({ status: 'UP', service: 'ms-coupon' });
  });

  it('acuerdo B2B: el administrador lo actualiza y Booking lo lee', async () => {
    const saved = await within('admin', () => client.updatePromotionAgreement({ permite_promociones: true, porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', 'banos'] }));
    expect(saved).toMatchObject({ permite_promociones: true, porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Baños', 'Quito'] });
    expect(await within('partner', () => client.getPromotionAgreement())).toEqual(saved);
    expect(await failure(within('partner', () => client.updatePromotionAgreement({ permite_promociones: false, porcentaje_descuento_maximo: 0 })))).toBe('403 INSUFFICIENT_SCOPE');
    expect(await failure(within('admin', () => client.updatePromotionAgreement({ permite_promociones: true, porcentaje_descuento_maximo: 10, destinos_habilitados: ['Lima'] })))).toBe('400 DESTINATION_NOT_FOUND');
  });

  it('cupones: crear, listar con filtros en la query, consultar, modificar y validar', async () => {
    await within('admin', () => client.createCoupon({ code: 'quito15', type: 'PORCENTAJE', value: 15, start_date: '2026-10-01' }));
    expect(await failure(within('admin', () => client.createCoupon({ code: 'QUITO15', type: 'FIJO', value: 1, start_date: '2026-10-01' })))).toBe('409 COUPON_CODE_EXISTS');

    const page = await within('admin', () => client.listCoupons({ active: true, code: 'qui', limit: 5 }));
    expect(page).toEqual({ metadata: { total_results: 1, page: 1, limit: 5, total_pages: 1, next_cursor: null }, data: [expect.objectContaining({ code: 'QUITO15' })] });

    expect((await within('admin', () => client.getCoupon('quito15'))).value).toBe(15);
    expect((await within('admin', () => client.updateCoupon('QUITO15', { max_uses: 10 }))).max_uses).toBe(10);
    expect(await failure(within('cliente', () => client.getCoupon('QUITO15')))).toBe('403 INSUFFICIENT_SCOPE');

    expect(await within('cliente', () => client.validateCoupon({ code: 'quito15', subtotal: 40 }))).toMatchObject({ valid: true, discount_amount: 6, max_uses: 10 });
    expect(await asService('order', SECRET, () => client.validateCoupon({ code: 'NOEXISTE', subtotal: 40 }))).toMatchObject({ valid: false, reason: 'COUPON_NOT_FOUND' });
  });
});
