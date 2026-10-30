process.env.LOG_SILENT = 'true';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { servicePrincipal, signInternalPrincipal, type Principal } from '@atracciones/platform';
import Ajv from 'ajv';
import { load } from 'js-yaml';
import request from 'supertest';
import { createMsCouponService, readMsCouponConfig, type CityDirectory } from '../src';
import { freshDatabase, type TestDatabase } from './database';

const SECRET = 'secreto-interno-de-pruebas-con-32-caracteres-o-mas';
const NOW = new Date('2026-10-25T15:00:00Z'); // 10:00 en Ecuador: hoy = 2026-10-25

const cities: CityDirectory = {
  cities: async () => [
    { id: 1, name: 'Quito' },
    { id: 2, name: 'Baños' },
    { id: 3, name: 'Cuenca' },
    { id: 4, name: 'Galápagos' },
  ],
};

const admin: Principal = { tipo: 'USUARIO', id: randomUUID(), scopes: ['attractions:read', 'attractions:write', 'promotions:read', 'promotions:write'], nombre: 'Admin' };
const partner: Principal = { tipo: 'API_CLIENTE', id: randomUUID(), scopes: ['attractions:read', 'attractions:book', 'promotions:read', 'events:read'], nombre: 'Booking Prototipo' };
const cliente: Principal = { tipo: 'USUARIO', id: randomUUID(), scopes: ['attractions:read', 'attractions:book'], nombre: 'Cliente' };

/** Esquema `PromocionesContratoResponse` del contrato v3 (la fuente de verdad de Booking). */
const V3 = join(__dirname, '..', '..', '..', '..', 'Plan', 'PlanBooking', 'atracciones-openapi-v3(1).yaml');
const v3 = load(readFileSync(V3, 'utf8')) as { components: { schemas: Record<string, { properties: Record<string, unknown> }> } };
const agreementSchema = v3.components.schemas.PromocionesContratoResponse;
const validateAgreement = new Ajv({ strict: false, validateFormats: false }).compile(agreementSchema);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Cumple el esquema v3 y no agrega campos que el contrato no define. */
function expectV3Agreement(body: Record<string, unknown>) {
  expect(validateAgreement(body) ? [] : validateAgreement.errors).toEqual([]);
  expect(Object.keys(body).filter((k) => !(k in agreementSchema.properties))).toEqual([]);
  expect(body.vigencia_hasta).toMatch(DATE);
}

describe('ms_coupon · API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createMsCouponService>['app'];
  const tokens = new Map<Principal, string>();

  const token = async (p: Principal) => {
    if (!tokens.has(p)) tokens.set(p, await signInternalPrincipal(p, SECRET, 3600));
    return tokens.get(p)!;
  };
  const as = (p: Principal) => ({
    get: async (path: string) => request(app).get(`/api/v3${path}`).set('x-internal-principal', await token(p)),
    post: async (path: string, body: object) => request(app).post(`/api/v3${path}`).set('x-internal-principal', await token(p)).send(body),
    put: async (path: string, body: object) => request(app).put(`/api/v3${path}`).set('x-internal-principal', await token(p)).send(body),
    patch: async (path: string, body: object) => request(app).patch(`/api/v3${path}`).set('x-internal-principal', await token(p)).send(body),
  });

  beforeAll(async () => {
    db = await freshDatabase();
    ({ app } = createMsCouponService(readMsCouponConfig({ INTERNAL_TOKEN_SECRET: SECRET }), db.dataSource, { cities, now: () => NOW }));
  });
  afterAll(() => db.drop());

  describe('acuerdo B2B (contrato v3)', () => {
    it('Booking lee el acuerdo inicial con el esquema exacto del contrato', async () => {
      const res = await as(partner).get('/atracciones/promociones/contrato');
      expect(res.status).toBe(200);
      expectV3Agreement(res.body);
      expect(res.body).toMatchObject({ proveedor_id: 'proveedor-atracciones-dilan', nombre_comercial: 'Descubre EC', permite_promociones: false, porcentaje_descuento_maximo: 0, destinos_habilitados: [] });
    });

    it('el administrador responde el cuestionario: destinos por nombre, sin tildes ni mayúsculas', async () => {
      const res = await as(admin).put('/atracciones/promociones/contrato', {
        permite_promociones: true,
        porcentaje_descuento_maximo: 15,
        destinos_habilitados: ['quito', 'BANOS', 'Cuenca', 'Galapagos'],
        vigencia_hasta: '2027-12-31',
        condiciones_combo: 'Aplica en paquetes de al menos 2 servicios con 48 horas de anticipación.',
        contacto_comercial: { nombre: 'Dilan Mendoza', email: 'dilan.mendoza@descubreec.com', telefono: '+593998765432' },
      });
      expect(res.status).toBe(200);
      expectV3Agreement(res.body);
      expect(res.body).toEqual({
        proveedor_id: 'proveedor-atracciones-dilan',
        nombre_comercial: 'Descubre EC',
        permite_promociones: true,
        porcentaje_descuento_maximo: 15,
        destinos_habilitados: ['Baños', 'Cuenca', 'Galápagos', 'Quito'],
        fecha_acuerdo: '2026-10-25',
        vigencia_hasta: '2027-12-31',
        condiciones_combo: 'Aplica en paquetes de al menos 2 servicios con 48 horas de anticipación.',
      });
      // El contacto se guarda aunque el contrato no lo devuelva.
      const [row] = await db.dataSource.query(`SELECT apr_contacto_nombre, apr_contacto_correo FROM acuerdo_promocion`);
      expect(row).toEqual({ apr_contacto_nombre: 'Dilan Mendoza', apr_contacto_correo: 'dilan.mendoza@descubreec.com' });
    });

    it('un PUT con solo las preguntas obligatorias conserva los opcionales', async () => {
      const res = await as(admin).put('/atracciones/promociones/contrato', { permite_promociones: true, porcentaje_descuento_maximo: 20 });
      expect(res.body).toMatchObject({ porcentaje_descuento_maximo: 20, vigencia_hasta: '2027-12-31', destinos_habilitados: ['Baños', 'Cuenca', 'Galápagos', 'Quito'] });
      expect(res.body.condiciones_combo).toContain('48 horas');
    });

    it.each([
      [{ permite_promociones: true, porcentaje_descuento_maximo: 60 }, 'VALIDATION_ERROR'],
      [{ porcentaje_descuento_maximo: 10 }, 'VALIDATION_ERROR'],
      [{ permite_promociones: true, porcentaje_descuento_maximo: 10, vigencia_hasta: '2026-10-24' }, 'VALIDATION_ERROR'],
      [{ permite_promociones: true, porcentaje_descuento_maximo: 10, destinos_habilitados: ['Quito', 'Atlantis'] }, 'DESTINATION_NOT_FOUND'],
    ])('400 (nunca 422) para %j', async (body, code) => {
      const res = await as(admin).put('/atracciones/promociones/contrato', body);
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body.code).toBe(code);
    });

    it('un socio con X-API-Key lee pero no modifica; un cliente no lee', async () => {
      expect((await as(partner).put('/atracciones/promociones/contrato', { permite_promociones: true, porcentaje_descuento_maximo: 5 })).status).toBe(403);
      expect((await as(cliente).get('/atracciones/promociones/contrato')).status).toBe(403);
      expect((await request(app).get('/api/v3/atracciones/promociones/contrato')).status).toBe(401);
    });

    it('vaciar los destinos con una lista vacía', async () => {
      const res = await as(admin).put('/atracciones/promociones/contrato', { permite_promociones: false, porcentaje_descuento_maximo: 0, destinos_habilitados: [] });
      expect(res.body.destinos_habilitados).toEqual([]);
      expectV3Agreement(res.body);
    });
  });

  describe('cupones', () => {
    it('el administrador crea un cupón (201 + Location, código en mayúsculas)', async () => {
      const res = await as(admin).post('/cupones', { code: 'bienvenida10', type: 'PORCENTAJE', value: 10, start_date: '2026-11-01', end_date: '2026-12-31', max_uses: 500 });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe('/api/v3/cupones/BIENVENIDA10');
      expect(res.body).toEqual({ code: 'BIENVENIDA10', type: 'PORCENTAJE', value: 10, start_date: '2026-11-01', end_date: '2026-12-31', max_uses: 500, active: true });
    });

    it('código repetido es 409; reglas de negocio 422; formato 400', async () => {
      expect((await as(admin).post('/cupones', { code: 'BIENVENIDA10', type: 'FIJO', value: 5, start_date: '2026-11-01' })).body.code).toBe('COUPON_CODE_EXISTS');
      expect((await as(admin).post('/cupones', { code: 'MAL', type: 'PORCENTAJE', value: 120, start_date: '2026-11-01' })).status).toBe(422);
      expect((await as(admin).post('/cupones', { code: 'X', type: 'FIJO', value: 5, start_date: '2026-11-01' })).status).toBe(400);
    });

    it('lista con filtros y paginación', async () => {
      await as(admin).post('/cupones', { code: 'FIJO5', type: 'FIJO', value: 5, start_date: '2026-10-01', active: false });
      await as(admin).post('/cupones', { code: 'VERANO20', type: 'PORCENTAJE', value: 20, start_date: '2026-10-01' });
      const all = await as(admin).get('/cupones?limit=2');
      expect(all.body.metadata).toEqual({ total_results: 3, page: 1, limit: 2, total_pages: 2, next_cursor: null });
      expect(all.body.data.map((c: { code: string }) => c.code)).toEqual(['BIENVENIDA10', 'FIJO5']);
      expect((await as(admin).get('/cupones?active=false')).body.data.map((c: { code: string }) => c.code)).toEqual(['FIJO5']);
      expect((await as(admin).get('/cupones?code=ver')).body.data.map((c: { code: string }) => c.code)).toEqual(['VERANO20']);
    });

    it('consulta y modifica vigencia, límite y estado; no código, tipo ni valor', async () => {
      expect((await as(admin).get('/cupones/bienvenida10')).body.code).toBe('BIENVENIDA10');
      expect((await as(admin).get('/cupones/NOEXISTE')).status).toBe(404);
      const res = await as(admin).patch('/cupones/BIENVENIDA10', { end_date: null, max_uses: null });
      expect(res.body).toMatchObject({ end_date: null, max_uses: null });
      expect((await as(admin).patch('/cupones/BIENVENIDA10', { value: 50 })).status).toBe(400);
      expect((await as(admin).patch('/cupones/BIENVENIDA10', { end_date: '2026-10-01' })).status).toBe(422);
      expect((await as(admin).patch('/cupones/NOEXISTE', { active: false })).status).toBe(404);
    });

    it('solo el administrador administra cupones', async () => {
      expect((await as(cliente).get('/cupones')).status).toBe(403);
      expect((await as(partner).post('/cupones', { code: 'HACK', type: 'FIJO', value: 100, start_date: '2026-11-01' })).status).toBe(403);
    });
  });

  describe('validación de cupones', () => {
    it('un cliente ve el descuento en el checkout (no consume el cupón)', async () => {
      const res = await as(cliente).post('/cupones/validacion', { code: 'verano20', subtotal: 75.55 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ code: 'VERANO20', valid: true, reason: null, type: 'PORCENTAJE', value: 20, discount_amount: 15.11, currency: 'USD', max_uses: null });
    });

    it('Order valida con su cuenta de servicio y recibe max_uses', async () => {
      const res = await as(servicePrincipal('order')).post('/cupones/validacion', { code: 'BIENVENIDA10', subtotal: 100, date: '2026-11-15' });
      expect(res.body).toMatchObject({ valid: true, discount_amount: 10 });
      await as(admin).patch('/cupones/BIENVENIDA10', { max_uses: 50 });
      expect((await as(servicePrincipal('order')).post('/cupones/validacion', { code: 'BIENVENIDA10', subtotal: 100, date: '2026-11-15' })).body.max_uses).toBe(50);
    });

    it.each([
      [{ code: 'NOEXISTE', subtotal: 50 }, 'COUPON_NOT_FOUND'],
      [{ code: 'FIJO5', subtotal: 50 }, 'COUPON_INACTIVE'],
      [{ code: 'BIENVENIDA10', subtotal: 50 }, 'COUPON_NOT_STARTED'],
    ])('200 con valid=false para %j', async (body, reason) => {
      const res = await as(cliente).post('/cupones/validacion', body);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ valid: false, reason, discount_amount: 0 });
    });

    it('cupón vencido', async () => {
      await as(admin).patch('/cupones/VERANO20', { end_date: '2026-10-20' });
      expect((await as(cliente).post('/cupones/validacion', { code: 'VERANO20', subtotal: 10 })).body.reason).toBe('COUPON_EXPIRED');
    });

    it('sin principal es 401; cuerpo inválido 400', async () => {
      expect((await request(app).post('/api/v3/cupones/validacion').send({ code: 'X', subtotal: 1 })).status).toBe(401);
      expect((await as(cliente).post('/cupones/validacion', { code: 'X', subtotal: 'diez' })).status).toBe(400);
    });
  });

  it('GET /api/v3/health y /health', async () => {
    expect((await request(app).get('/api/v3/health')).body).toMatchObject({ status: 'UP', service: 'ms-coupon', database_connected: true });
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
