import { AppError, runWithContext } from '@atracciones/platform';
import { FakeIdempotency, LOGISTICS, remoteSpy, reservationRow, SLOT } from '../../test/fakes';
import { onceByKey } from './idempotency';
import { parseAsistentes, parseIdempotencyKey, parsePurchase, parseSolicitante } from './input';
import { Remote } from './remote';
import { notificationStatus, toResponse } from './reservation-mapper';
import { createVoucher, verifyVoucher } from './voucher';

const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const purchase = (overrides: Record<string, unknown> = {}) => ({
  idempotency_key: KEY, attraction_id: 'A1', slot_id: 'slot-20261125-1030', date: '2026-11-25', time: '10:30 a.m.', adult_count: 2,
  customer: { full_name: 'Ana Pérez', email: 'ANA@correo.com', phone: '099 123 4567', document_type: 'CEDULA', document_id: '1710034065' },
  payment_method: { method: 'CREDIT_CARD' }, ...overrides,
});

describe('ms-booking/reservation-mapper · respuesta del contrato', () => {
  it('ReservaConfirmadaResponseV2 con alias en español, hora 12 h, USD y PNR', () => {
    const row = reservationRow({ res_codigo: 'DEC-ABC234', ord_numero: 'ORD-7' });
    const res = toResponse(row, SLOT, LOGISTICS, '/api/v3');
    expect(res).toMatchObject({
      external_order_id: 'ORD-7', reservation_code: 'DEC-ABC234', status: 'CONFIRMED', estado: 'CONFIRMED', date: '2026-11-25', fecha: '2026-11-25',
      time: '10:30 a.m.', hora: '10:30 a.m.', total_price: 90, precio_total: 90, currency: 'USD', moneda: 'USD', adult_count: 2, cantidad_adultos: 2,
      guia_asignado: 'Carlos', punto_encuentro: 'Parque central', attraction_id: 'PRhu4UBTWPBC',
    });
    expect(res.customer).toMatchObject({ full_name: 'Ana Pérez', nombre_completo: 'Ana Pérez', document_id: '1710034065', numero_documento: '1710034065' });
  });

  it('_links HATEOAS con self, checkin y cancel', () => {
    const row = reservationRow();
    expect(toResponse(row, SLOT, LOGISTICS, '/api/v3')._links).toEqual({
      self: `/api/v3/atracciones/reservas/${row.res_uuid}`, checkin: `/api/v3/atracciones/reservas/${row.res_uuid}/checkin`, cancel: `/api/v3/atracciones/reservas/${row.res_uuid}/cancel`,
    });
  });

  it('cancelada: cancel_code, refund y stock_restoration; activa: sin esos campos', () => {
    const cancelled = toResponse(reservationRow({ est_codigo: 'CANCELLED', res_reembolso_id: null }), SLOT, LOGISTICS, '/api/v3');
    expect(cancelled.cancel_code).toMatch(/^REF-ATR-/);
    expect(cancelled.stock_restoration).toMatchObject({ status: 'RESTORED', restored_spots: 2 });
    expect(toResponse(reservationRow(), SLOT, LOGISTICS, '/api/v3')).not.toHaveProperty('refund');
  });

  it('sin logística: guía "Por asignar" y punto de encuentro vacío; client_id vacío en compras web', () => {
    expect(toResponse(reservationRow({ cla_id_cliente: null }), SLOT, null, '/api/v3')).toMatchObject({ guia_asignado: 'Por asignar', punto_encuentro: '', client_id: '' });
  });

  it('estado del aviso a Booking Central: NO_APLICA, PENDIENTE, ENVIADA y FALLIDA', () => {
    expect(notificationStatus(reservationRow({ nch_intentos: null }))).toBe('NO_APLICA');
    expect(notificationStatus(reservationRow({ nch_intentos: 1 }))).toBe('PENDIENTE');
    expect(notificationStatus(reservationRow({ nch_intentos: 1, nch_enviado_en: new Date() }))).toBe('ENVIADA');
    expect(notificationStatus(reservationRow({ nch_intentos: 15 }))).toBe('FALLIDA');
  });
});

describe('ms-booking/voucher · QR firmado', () => {
  const secret = 'secreto-del-voucher-de-pruebas-con-32-caracteres';
  it('firma y verifica el voucher de la reserva', () => {
    expect(verifyVoucher(createVoucher({ reservationId: 'R1', code: 'DEC-1', document: '1710034065' }, secret), 'R1', secret)).toBe(true);
  });
  it('rechaza el voucher de otra reserva o con otro secreto', () => {
    const v = createVoucher({ reservationId: 'R1', code: 'DEC-1', document: 'x' }, secret);
    expect(verifyVoucher(v, 'R2', secret)).toBe(false);
    expect(verifyVoucher(v, 'R1', `${secret}-otro`)).toBe(false);
  });
  it('rechaza un voucher alterado o mal formado', () => {
    const [body, sig] = createVoucher({ reservationId: 'R1', code: 'DEC-1', document: 'x' }, secret).split('.');
    expect(verifyVoucher(`${body}x.${sig}`, 'R1', secret)).toBe(false);
    expect(verifyVoucher('sin-punto', 'R1', secret)).toBe(false);
  });
});

describe('ms-booking/idempotency · onceByKey', () => {
  const subject = { tipo: 'CLIENTE_API' as const, id: 9 };
  it('misma clave y cuerpo → respuesta guardada sin repetir el trabajo', async () => {
    const repo = new FakeIdempotency().asRepository();
    const work = jest.fn(async () => ({ ok: 1 }));
    await onceByKey(repo, 'k', subject, 'Op', { a: 1 }, work);
    await expect(onceByKey(repo, 'k', subject, 'Op', { a: 1 }, work)).resolves.toEqual({ ok: 1 });
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('misma clave con otro cuerpo → 409 IDEMPOTENCY_CONFLICT; en curso → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const repo = new FakeIdempotency();
    await onceByKey(repo.asRepository(), 'k', subject, 'Op', { a: 1 }, async () => 1);
    await expect(onceByKey(repo.asRepository(), 'k', subject, 'Op', { a: 2 }, async () => 1)).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    await repo.reserve('k2', subject, 'Op', 'h');
    repo.entries.get('CLIENTE_API:9:k2')!.hash = (await import('@atracciones/platform')).payloadHash({ b: 1 });
    await expect(onceByKey(repo.asRepository(), 'k2', subject, 'Op', { b: 1 }, async () => 1)).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
  });
  it('si el trabajo falla, la clave queda FAILED y un reintento vuelve a ejecutarlo', async () => {
    const repo = new FakeIdempotency().asRepository();
    await expect(onceByKey(repo, 'k', subject, 'Op', {}, async () => { throw AppError.unavailable(); })).rejects.toMatchObject({ status: 503 });
    await expect(onceByKey(repo, 'k', subject, 'Op', {}, async () => 'ok')).resolves.toBe('ok');
  });
});

describe('ms-booking/input · CreateReservation, cancelación y check-in', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') }));
  afterEach(() => jest.useRealTimers());

  it('P7 · normaliza el titular (correo en minúsculas, teléfono sin espacios) y cuenta los boletos', () => {
    expect(parsePurchase(purchase({ child_count: 1 }))).toMatchObject({ idempotencyKey: KEY, adultos: 2, ninos: 1, infantes: 0, customer: { correo: 'ana@correo.com', telefono: '0991234567', tipoDocumento: 'CEDULA' } });
  });

  it('P7 · slot_id que no coincide con fecha u hora → 400 SLOT_TIME_MISMATCH', () => {
    expect(() => parsePurchase(purchase({ time: '11:00:00' }))).toThrow(expect.objectContaining({ status: 400, code: 'SLOT_TIME_MISMATCH' }));
    expect(() => parsePurchase(purchase({ date: '2026-11-26' }))).toThrow(expect.objectContaining({ code: 'SLOT_TIME_MISMATCH' }));
  });

  it('P7 · fecha pasada, sin adultos o titular inválido → 422', () => {
    expect(() => parsePurchase(purchase({ slot_id: 'slot-20261119-1030', date: '2026-11-19' }))).toThrow(expect.objectContaining({ status: 422, code: 'DATE_IN_PAST' }));
    expect(() => parsePurchase(purchase({ adult_count: 0 }))).toThrow(expect.objectContaining({ status: 422, code: 'INVALID_TICKET_COUNT' }));
    expect(() => parsePurchase(purchase({ customer: { full_name: 'Ana', email: 'x', phone: '1', document_id: '1710034064' } }))).toThrow(expect.objectContaining({ status: 422, code: 'INVALID_CUSTOMER' }));
  });

  it('P7 · método de pago o slot_id con formato inválido → 400 con invalid_params', () => {
    try {
      parsePurchase(purchase({ payment_method: { method: 'EFECTIVO' }, slot_id: 'turno-1' }));
      throw new Error('no lanzó');
    } catch (error) {
      expect((error as AppError).invalidParams?.map((p) => p.name)).toEqual(['payment_method.method', 'slot_id']);
    }
  });

  it('Idempotency-Key: del mensaje o del contexto, siempre UUID', () => {
    expect(parseIdempotencyKey(KEY.toUpperCase())).toBe(KEY);
    expect(runWithContext({ correlationId: 'c', idempotencyKey: KEY }, () => parseIdempotencyKey(''))).toBe(KEY);
    expect(() => parseIdempotencyKey('no-uuid')).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('solicitante por defecto CLIENTE y asistentes_reales positivos', () => {
    expect(parseSolicitante(undefined)).toBe('CLIENTE');
    expect(() => parseSolicitante('OTRO')).toThrow(expect.objectContaining({ status: 400 }));
    expect(parseAsistentes(0)).toBeNull();
    expect(() => parseAsistentes(-1)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('ms-booking/remote · traducción de errores del ESB', () => {
  const esb = (impl: (...args: unknown[]) => unknown) => ({ call: jest.fn(async (...args: unknown[]) => impl(...args)) });

  it('atracción inexistente en Catalog (404) → 422 ATTRACTION_NOT_FOUND', async () => {
    const remote = new Remote(esb(() => { throw AppError.notFound('x'); }) as never);
    await expect(remote.reference('X')).rejects.toMatchObject({ status: 422, code: 'ATTRACTION_NOT_FOUND' });
  });

  it('refund sin pago aprobado → null; otro error se propaga', async () => {
    await expect(new Remote(esb(() => { throw AppError.conflict('NO_APPROVED_PAYMENT', 'x'); }) as never).refund(1, 'm', 'k')).resolves.toBeNull();
    await expect(new Remote(esb(() => { throw AppError.unavailable(); }) as never).refund(1, 'm', 'k')).rejects.toMatchObject({ status: 503 });
  });

  it('reservationLogistics sin guía guardado no asigna guía; ensureClient devuelve el id numérico', async () => {
    const client = esb((_service, operation) => (operation === 'ensureClient' ? { client_id: '42' } : LOGISTICS));
    const remote = new Remote(client as never);
    await expect(remote.reservationLogistics('A1', null)).resolves.toMatchObject({ guia: null });
    await expect(remote.ensureClient({ nombre: 'a', correo: 'b', documento: 'c', telefono: 'd' })).resolves.toBe(42);
    expect(remoteSpy).toBeDefined();
  });
});
