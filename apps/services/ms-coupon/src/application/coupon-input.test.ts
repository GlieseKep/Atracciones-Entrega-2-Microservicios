import { AppError } from '@atracciones/platform';
import { parseCouponCreate, parseCouponFilters, parseCouponPatch, parseValidation } from './coupon-input';

const failure = (work: () => unknown) => {
  try {
    work();
    return null;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, fields: error.invalidParams?.map((p) => p.name) };
    throw error;
  }
};

const valid = { code: 'bienvenida10', type: 'PORCENTAJE', value: 10, start_date: '2026-11-01', end_date: '2026-12-31', max_uses: 500 };

describe('CouponCreateRequest', () => {
  it('normaliza el código a mayúsculas y pone los valores por defecto', () => {
    expect(parseCouponCreate({ code: ' bienvenida10 ', type: 'FIJO', value: 5, start_date: '2026-11-01' })).toEqual({
      code: 'BIENVENIDA10', type: 'FIJO', value: 5, startDate: '2026-11-01', endDate: null, maxUses: null, active: true,
    });
  });

  it('formato o tipo inválido es 400', () => {
    expect(failure(() => parseCouponCreate({ ...valid, code: 'ab' }))).toEqual({ status: 400, fields: ['code'] });
    expect(failure(() => parseCouponCreate({ ...valid, code: 'CON ESPACIO' }))?.fields).toEqual(['code']);
    expect(failure(() => parseCouponCreate({ ...valid, type: 'MONTO' }))?.fields).toEqual(['type']);
    expect(failure(() => parseCouponCreate({ ...valid, value: -1 }))?.fields).toEqual(['value']);
    expect(failure(() => parseCouponCreate({ ...valid, value: 1.005 }))?.fields).toEqual(['value']);
    expect(failure(() => parseCouponCreate({ ...valid, max_uses: 0 }))?.fields).toEqual(['max_uses']);
    expect(failure(() => parseCouponCreate({ ...valid, start_date: '01/11/2026' }))?.fields).toEqual(['start_date']);
  });

  it('reglas de negocio son 422', () => {
    expect(failure(() => parseCouponCreate({ ...valid, value: 101 }))).toEqual({ status: 422, fields: ['value'] });
    expect(failure(() => parseCouponCreate({ ...valid, end_date: '2026-10-31' }))).toEqual({ status: 422, fields: ['end_date'] });
    // Un monto FIJO mayor a 100 sí es válido.
    expect(parseCouponCreate({ ...valid, type: 'FIJO', value: 150 }).value).toBe(150);
  });
});

describe('CouponUpdateRequest', () => {
  it('solo trae lo enviado; null quita la fecha de fin o el límite', () => {
    expect(parseCouponPatch({ end_date: null, max_uses: null })).toEqual({ endDate: null, maxUses: null });
    expect(parseCouponPatch({ active: false })).toEqual({ active: false });
  });

  it('código, tipo y valor no se cambian', () => {
    expect(failure(() => parseCouponPatch({ value: 20, type: 'FIJO' }))).toEqual({ status: 400, fields: ['type', 'value'] });
  });

  it('sin cambios es 400', () => expect(failure(() => parseCouponPatch({}))?.status).toBe(400));
});

describe('filtros y validación', () => {
  it('filtros con valores por defecto y límites', () => {
    expect(parseCouponFilters({})).toEqual({ active: null, code: null, page: 1, limit: 10 });
    expect(parseCouponFilters({ active: 'false', code: 'bien', page: '2', limit: '50' })).toEqual({ active: false, code: 'bien', page: 2, limit: 50 });
    expect(failure(() => parseCouponFilters({ limit: '51' }))?.fields).toEqual(['limit']);
    expect(failure(() => parseCouponFilters({ active: 'si' }))?.fields).toEqual(['active']);
  });

  it('CouponValidationRequest', () => {
    expect(parseValidation({ code: 'bienvenida10', subtotal: 75 })).toEqual({ code: 'BIENVENIDA10', subtotal: 75, currency: 'USD', date: null });
    expect(failure(() => parseValidation({ code: 'X', subtotal: -5 }))?.fields).toEqual(['subtotal']);
    expect(failure(() => parseValidation({ code: 'X', subtotal: 5, currency: 'usd', date: 'hoy' }))?.fields).toEqual(['currency', 'date']);
  });
});
