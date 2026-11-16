import { AppError, type EsbClient } from '@atracciones/platform';
import type { ReembolsoDto } from '../contract';
import type { RefundRepository } from '../persistence/refund-repository';
import { parseIdempotencyKey, parseRefund } from './refund-input';
import { RefundService } from './refund-service';

const REFUND = { id: 1, pag_id: 5, monto_reembolsado: 90, estado: 'EMITIDO' } as unknown as ReembolsoDto;
const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

function setup(payments: () => unknown = () => [{ id: 5, estado: 'APROBADO', monto: 90 }], existing: ReembolsoDto | null = null) {
  const call = jest.fn(async () => payments());
  const repo = { findByKey: jest.fn(async () => existing), emit: jest.fn(async () => REFUND) };
  return { service: new RefundService(repo as unknown as RefundRepository, { call } as unknown as EsbClient), repo, call };
}

afterEach(() => jest.restoreAllMocks());

describe('ms-refund/refund-service · P9 reembolso', () => {
  it('reembolso completo del pago aprobado de la orden', async () => {
    const { service, repo, call } = setup();
    await expect(service.emit({ ord_id: 11, monto: null, motivo: 'Cancelación' }, KEY)).resolves.toEqual({ refund: REFUND, created: true });
    expect(call).toHaveBeenCalledWith('payment', 'listOrderPayments', { ordId: 11 });
    expect(repo.emit).toHaveBeenCalledWith({ id: 5, monto: 90 }, { ord_id: 11, monto: null, motivo: 'Cancelación' }, KEY);
  });
  it('sin pago aprobado → 409 NO_APPROVED_PAYMENT', async () => {
    const { service } = setup(() => [{ id: 5, estado: 'RECHAZADO', monto: 90 }]);
    await expect(service.emit({ ord_id: 11, monto: null, motivo: null }, KEY)).rejects.toMatchObject({ status: 409, code: 'NO_APPROVED_PAYMENT' });
  });
  it('ya reembolsado con la misma clave → mismo reembolso, sin emitir otro', async () => {
    const { service, repo } = setup(undefined, REFUND);
    await expect(service.emit({ ord_id: 11, monto: null, motivo: null }, KEY)).resolves.toMatchObject({ created: false, refund: { id: 1 } });
    expect(repo.emit).not.toHaveBeenCalled();
  });
  it('misma clave con otro monto → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const { service } = setup(undefined, REFUND);
    await expect(service.emit({ ord_id: 11, monto: 10, motivo: null }, KEY)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });
  it('Payment caído → 503 PAYMENT_UNAVAILABLE (nunca reembolsa sin conocer el monto)', async () => {
    const { service, repo } = setup(() => { throw AppError.unavailable(); });
    await expect(service.emit({ ord_id: 11, monto: null, motivo: null }, KEY)).rejects.toMatchObject({ status: 503, code: 'PAYMENT_UNAVAILABLE' });
    expect(repo.emit).not.toHaveBeenCalled();
  });
});

describe('ms-refund/refund-input', () => {
  it('reembolso válido sin monto (total) y motivo opcional', () => {
    expect(parseRefund({ ord_id: 11 })).toEqual({ ord_id: 11, monto: null, motivo: null });
  });
  it('monto 0 u ord_id inválido → 400', () => {
    expect(() => parseRefund({ ord_id: 0, monto: 0 })).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('Idempotency-Key UUID obligatoria', () => {
    expect(parseIdempotencyKey(KEY.toUpperCase())).toBe(KEY);
    expect(() => parseIdempotencyKey('x')).toThrow(expect.objectContaining({ status: 400 }));
  });
});
