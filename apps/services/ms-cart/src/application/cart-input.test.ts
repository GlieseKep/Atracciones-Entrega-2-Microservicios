import { AppError } from '@atracciones/platform';
import { MAX_TICKETS, parseIdempotencyKey, parseItem, parseItemPatch, parseOrderNumber } from './cart-input';

const statusOf = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code, fields: error.invalidParams?.map((p) => p.name) };
    throw error;
  }
  return null;
};

describe('CartItemRequest', () => {
  it('lee los campos canónicos y pone 0 en las cantidades que faltan', () => {
    expect(parseItem({ attraction_id: ' PRhu4UBTWPBC ', slot_id: 'slot-20261025-1030', adult_count: 2, infant_count: 1 })).toEqual({
      attractionId: 'PRhu4UBTWPBC',
      slot: 'slot-20261025-1030',
      counts: { adult: 2, child: 0, senior: 0, student: 0, infant: 1 },
    });
  });

  it('el turno es opcional', () => {
    expect(parseItem({ attraction_id: 'PRhu4UBTWPBC', adult_count: 1 }).slot).toBeNull();
    expect(parseItem({ attraction_id: 'PRhu4UBTWPBC', slot_id: null, adult_count: 1 }).slot).toBeNull();
  });

  it('adult_count 0 es una regla de negocio: 422', () => {
    expect(statusOf(() => parseItem({ attraction_id: 'PRhu4UBTWPBC', adult_count: 0 }))).toEqual({ status: 422, code: 'SEMANTIC_VALIDATION_FAILED', fields: ['adult_count'] });
  });

  it('una cantidad negativa también es 422', () => {
    expect(statusOf(() => parseItem({ attraction_id: 'PRhu4UBTWPBC', adult_count: 1, child_count: -1 }))?.status).toBe(422);
  });

  it(`más de ${MAX_TICKETS} boletos es 422`, () => {
    expect(statusOf(() => parseItem({ attraction_id: 'PRhu4UBTWPBC', adult_count: MAX_TICKETS, child_count: 1 }))?.status).toBe(422);
  });

  it('tipos erróneos o formato inválido son 400', () => {
    expect(statusOf(() => parseItem({ attraction_id: 'PRhu4UBTWPBC', adult_count: '2' }))).toEqual({ status: 400, code: 'VALIDATION_ERROR', fields: ['adult_count'] });
    expect(statusOf(() => parseItem({ attraction_id: 'PRhu4UBTWPBC', adult_count: 1.5 }))?.status).toBe(400);
    expect(statusOf(() => parseItem({ attraction_id: 'PRhu4UBTWPBC', adult_count: 1, slot_id: '2026-10-25 10:30' }))?.fields).toEqual(['slot_id']);
    expect(statusOf(() => parseItem({ adult_count: 1 }))?.fields).toEqual(['attraction_id']);
    expect(statusOf(() => parseItem({ attraction_id: 'PRhu4UBTWPBC' }))?.fields).toEqual(['adult_count']);
    expect(statusOf(() => parseItem([]))?.status).toBe(400);
  });
});

describe('CartItemUpdateRequest', () => {
  it('solo trae los campos enviados', () => {
    expect(parseItemPatch({ child_count: 2 })).toEqual({ counts: { child: 2 } });
    expect(parseItemPatch({ slot_id: null })).toEqual({ slot: null, counts: {} });
  });

  it('sin campos conocidos es 400', () => {
    expect(statusOf(() => parseItemPatch({}))?.status).toBe(400);
    expect(statusOf(() => parseItemPatch({ color: 'azul' }))?.status).toBe(400);
  });
});

describe('rutas internas', () => {
  it('external_order_id obligatorio, de 1 a 20 caracteres', () => {
    expect(parseOrderNumber({ external_order_id: 'ORD-DILAN-8721' })).toBe('ORD-DILAN-8721');
    expect(statusOf(() => parseOrderNumber({}))?.status).toBe(400);
    expect(statusOf(() => parseOrderNumber({ external_order_id: 'X'.repeat(21) }))?.status).toBe(400);
  });

  it('Idempotency-Key debe ser un UUID', () => {
    expect(parseIdempotencyKey('9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D')).toBe('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
    expect(statusOf(() => parseIdempotencyKey(undefined))?.status).toBe(400);
    expect(statusOf(() => parseIdempotencyKey('clave-1'))?.status).toBe(400);
  });
});
