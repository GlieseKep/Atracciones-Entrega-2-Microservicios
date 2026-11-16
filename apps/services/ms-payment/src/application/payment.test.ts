import { AppError, createLogger, type EventBus, type EventEnvelope } from '@atracciones/platform';
import type { PaymentGateway } from '../integration/gateways/gateway';
import { signWebhook } from '../integration/gateways/simulated-gateway';
import type { PaymentRepository } from '../persistence/payment-repository';
import { parsePayment, parseWebhook } from './input';
import { PaymentService } from './payment-service';
import { assertSignature, enqueueWebhook, webhookHandler } from './webhook-processor';

process.env.LOG_SILENT = 'true';
const logger = createLogger('pruebas');
const SECRET = 'secreto-webhook';

const pago = { id: 5, numero: 'PAG-ORD-1-1', estado: 'PENDIENTE' } as never;

function setup(applyResult: jest.Mock = jest.fn(async () => ({ payment: pago, applied: true }))) {
  const repo = {
    create: jest.fn(async () => ({ payment: pago, created: true })),
    findById: jest.fn(async () => pago),
    findByNumber: jest.fn(async (numero: string) => (numero === 'PAG-ORD-1-1' ? pago : null)),
    applyResult,
    markFailed: jest.fn(async () => undefined),
    cancel: jest.fn(async () => null),
  };
  const gateway = { charge: jest.fn() };
  return { repo, gateway, service: new PaymentService(repo as unknown as PaymentRepository, gateway as unknown as PaymentGateway, logger) };
}

afterEach(() => jest.restoreAllMocks());

describe('ms-payment/payment-service', () => {
  const input = (canal: 'WEB' | 'B2B', metodo = 'CREDIT_CARD') => ({ numero: 'PAG-1', ord_id: 1, metodo, monto: 90, moneda: 'USD', canal, tarjeta: { ultimos4: '4242' } }) as never;

  it('pago web con tarjeta → se llama a la pasarela una vez', async () => {
    const { service, gateway } = setup();
    await service.register(input('WEB'));
    expect(gateway.charge).toHaveBeenCalledTimes(1);
    expect(gateway.charge.mock.calls[0][0]).toMatchObject({ numero: 'PAG-1', monto: 90, ultimos4: '4242' });
  });
  it('venta B2B (Booking) no pasa por la pasarela', async () => {
    const { service, gateway } = setup();
    await service.register(input('B2B'));
    expect(gateway.charge).not.toHaveBeenCalled();
  });
  it('pago repetido (no creado) no vuelve a cobrar', async () => {
    const { service, gateway, repo } = setup();
    repo.create.mockResolvedValue({ payment: pago, created: false });
    await service.register(input('WEB'));
    expect(gateway.charge).not.toHaveBeenCalled();
  });
  it('segundo aprobado de la misma orden → el pago queda FALLIDO para devolverlo', async () => {
    const { service, repo } = setup(jest.fn(async () => { throw AppError.conflict('PAYMENT_ALREADY_APPROVED', 'x'); }));
    await service.applyResult(5, { aprobado: true, referencia: null, autorizacion: null });
    expect(repo.markFailed).toHaveBeenCalledWith(5);
  });
  it('pago inexistente → 404 PAYMENT_NOT_FOUND', async () => {
    const { service, repo } = setup();
    repo.findById.mockResolvedValue(null as never);
    await expect(service.get(9)).rejects.toMatchObject({ status: 404, code: 'PAYMENT_NOT_FOUND' });
  });
});

describe('ms-payment/webhook-processor', () => {
  const ev = (data: Record<string, unknown>): EventEnvelope => ({ specversion: '1.0', id: 'e', source: '', type: 'WebhookRecibido', subject: '', time: '', correlation_id: '', data });

  it('aprobado → applyResult con aprobado true y la referencia', async () => {
    const { service, repo } = setup();
    await webhookHandler(repo as unknown as PaymentRepository, service, logger)(ev({ numero: 'PAG-ORD-1-1', resultado: 'APROBADO', referencia: 'R1', autorizacion: 'A1' }));
    expect(repo.applyResult).toHaveBeenCalledWith(5, { aprobado: true, referencia: 'R1', autorizacion: 'A1' });
  });
  it('rechazado → applyResult con el motivo (o uno por defecto)', async () => {
    const { service, repo } = setup();
    await webhookHandler(repo as unknown as PaymentRepository, service, logger)(ev({ numero: 'PAG-ORD-1-1', resultado: 'RECHAZADO' }));
    expect(repo.applyResult).toHaveBeenCalledWith(5, { aprobado: false, motivo: 'Pago rechazado por la pasarela.' });
  });
  it('firma inválida → 401; firma correcta pasa', () => {
    const body = { numero: 'PAG-1', resultado: 'APROBADO' };
    expect(() => assertSignature(body, 'firma-falsa', SECRET)).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => assertSignature(body, signWebhook(body, SECRET), SECRET)).not.toThrow();
    expect(() => assertSignature(body, undefined, SECRET)).toThrow(expect.objectContaining({ status: 401 }));
  });
  it('webhook repetido sobre un pago en estado final se ignora sin error', async () => {
    const { service, repo } = setup(jest.fn(async () => ({ payment: pago, applied: false })));
    await expect(webhookHandler(repo as unknown as PaymentRepository, service, logger)(ev({ numero: 'PAG-ORD-1-1', resultado: 'APROBADO' }))).resolves.toBeUndefined();
  });
  it('pago desconocido se descarta; bus caído al encolar → 503', async () => {
    const { service, repo } = setup();
    await webhookHandler(repo as unknown as PaymentRepository, service, logger)(ev({ numero: 'NO-EXISTE', resultado: 'APROBADO' }));
    expect(repo.applyResult).not.toHaveBeenCalled();
    const bus = { publish: jest.fn(async () => { throw new Error('caído'); }) } as unknown as EventBus;
    await expect(enqueueWebhook(bus, { numero: 'x', resultado: 'APROBADO' } as never)).rejects.toMatchObject({ status: 503 });
  });
});

describe('ms-payment/input', () => {
  const valid = { numero: 'PAG-1', ord_id: 1, metodo: 'CREDIT_CARD', monto: 90, canal: 'B2B' };
  it('B2B con tarjeta sin datos es válido (los datos solo se exigen en WEB)', () => {
    expect(parsePayment(valid)).toMatchObject({ moneda: 'USD', tarjeta: null });
  });
  it('WEB con tarjeta y sin datos → 422 CARD_DATA_REQUIRED; nunca guarda el número completo', () => {
    expect(() => parsePayment({ ...valid, canal: 'WEB' })).toThrow(expect.objectContaining({ status: 422, code: 'CARD_DATA_REQUIRED' }));
    const parsed = parsePayment({ ...valid, canal: 'WEB', tarjeta: { marca: 'VISA', ultimos4: '4242', titular: 'Ana', mes: 12, anio: 2030, pais: 'ec', numero: '4242424242424242', cvv: '123' } });
    expect(parsed.tarjeta).toEqual({ marca: 'VISA', ultimos4: '4242', titular: 'Ana', mes: 12, anio: 2030, pais: 'EC' });
  });
  it('webhook sin numero o con resultado desconocido → 400', () => {
    expect(() => parseWebhook({ resultado: 'APROBADO' })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseWebhook({ numero: 'x', resultado: 'OTRO' })).toThrow();
  });
});
