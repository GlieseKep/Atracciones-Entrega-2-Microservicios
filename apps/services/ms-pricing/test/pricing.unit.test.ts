import { createLogger } from '@atracciones/platform';
import { EffectiveTariffsJob } from '../src/events/effective-tariffs-job';
import type { PricingRepository, TariffRow } from '../src/persistence/pricing-repository';
import { parseBoletos, parseSetPriceTable } from '../src/application/input';
import { priceTableOf, tariffUpdatedPayload, toTariff } from '../src/application/price-table';
import { buildQuote } from '../src/application/quote';

const tariff = (tipo: TariffRow['tar_tipo'], precio: string, desde = '2026-01-01', hasta: string | null = null): TariffRow =>
  ({ tar_id: String(tipo.length), atr_codigo: 'PRhu4UBTWPBC', tar_tipo: tipo, tar_precio: precio, tar_moneda: 'USD', tar_vigente_desde: desde, tar_vigente_hasta: hasta });
const TABLE = [tariff('ADULT', '45.00'), tariff('CHILD', '22.50'), tariff('SENIOR', '31.50'), tariff('INFANT', '0.00')];

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ms-pricing/quote · cotización por edad (P7)', () => {
  const quote = (boletos: { type: 'ADULT' | 'CHILD' | 'SENIOR' | 'INFANT' | 'STUDENT'; cantidad: number }[], rows = TABLE) => buildQuote('PRhu4UBTWPBC', '2026-11-25', boletos, rows);

  it('adulto', () => expect(quote([{ type: 'ADULT', cantidad: 2 }])).toMatchObject({ total: 90, currency: 'USD', lines: [{ ticket_type: 'ADULT', unit_price: 45, subtotal: 90 }] }));
  it('niño', () => expect(quote([{ type: 'CHILD', cantidad: 1 }]).total).toBe(22.5));
  it('senior', () => expect(quote([{ type: 'SENIOR', cantidad: 3 }]).total).toBe(94.5));
  it('infante gratis', () => expect(quote([{ type: 'INFANT', cantidad: 2 }]).total).toBe(0));
  it('mezcla de edades suma cada línea', () => {
    const q = quote([{ type: 'ADULT', cantidad: 2 }, { type: 'CHILD', cantidad: 1 }, { type: 'INFANT', cantidad: 1 }]);
    expect(q.lines.map((l) => l.subtotal)).toEqual([90, 22.5, 0]);
    expect(q.total).toBe(112.5);
  });
  it('redondeo monetario', () => expect(quote([{ type: 'ADULT', cantidad: 3 }], [tariff('ADULT', '33.335')]).lines[0].subtotal).toBe(100.01));
  it('tipo sin tarifa (STUDENT) → 422 PRICE_NOT_AVAILABLE, nunca $0', () => {
    expect(() => quote([{ type: 'STUDENT', cantidad: 1 }])).toThrow(expect.objectContaining({ status: 422, code: 'PRICE_NOT_AVAILABLE' }));
  });
  it('fecha sin vigencia (sin filas) → 422', () => {
    expect(() => quote([{ type: 'ADULT', cantidad: 1 }], [])).toThrow(expect.objectContaining({ code: 'PRICE_NOT_AVAILABLE' }));
  });
});

describe('ms-pricing/price-table', () => {
  it('tabla completa con estudiante opcional', () => {
    expect(priceTableOf('A', '2026-11-25', TABLE)).toEqual({ attraction_id: 'A', date: '2026-11-25', currency: 'USD', adult: 45, child: 22.5, senior: 31.5, infant: 0 });
    expect(priceTableOf('A', 'd', [...TABLE, tariff('STUDENT', '30')])).toMatchObject({ student: 30 });
  });
  it('tabla incompleta → null', () => {
    expect(priceTableOf('A', 'd', TABLE.slice(0, 3))).toBeNull();
  });
  it('payload de TARIFA_ACTUALIZADA con la tabla vigente completa', () => {
    const table = priceTableOf('A', 'd', TABLE)!;
    expect(tariffUpdatedPayload(table)).toEqual({ attraction_id: 'A', current_prices: table });
  });
  it('tarifa vigente hoy vs futura vs vencida', () => {
    expect(toTariff(tariff('ADULT', '1', '2026-01-01'), '2026-11-20').current).toBe(true);
    expect(toTariff(tariff('ADULT', '1', '2026-12-01'), '2026-11-20').current).toBe(false);
    expect(toTariff(tariff('ADULT', '1', '2026-01-01', '2026-06-30'), '2026-11-20')).toMatchObject({ current: false, valid_to: '2026-06-30' });
  });
});

describe('ms-pricing/input', () => {
  it('boletos: tipo repetido, desconocido o cantidad 0 → 400', () => {
    expect(() => parseBoletos({ boletos: [{ ticket_type: 'ADULT', cantidad: 1 }, { ticket_type: 'ADULT', cantidad: 1 }] } as never)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseBoletos({ boletos: [{ ticket_type: 'BEBE', cantidad: 1 }] } as never)).toThrow();
    expect(() => parseBoletos({ boletos: [] } as never)).toThrow();
  });
  it('tabla nueva: adulto > 0, infante siempre 0 y vigencia no pasada', () => {
    const base = { attraction_id: 'PRhu4UBTWPBC', adult: 50, child: 25, senior: 35 };
    expect(parseSetPriceTable(base as never, '2026-11-20')).toMatchObject({ validFrom: '2026-11-20', prices: { ADULT: 50, INFANT: 0 } });
    expect(() => parseSetPriceTable({ ...base, adult: 0 } as never, '2026-11-20')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseSetPriceTable({ ...base, valid_from: '2026-11-19' } as never, '2026-11-20')).toThrow(expect.objectContaining({ invalidParams: [expect.objectContaining({ name: 'valid_from' })] }));
  });
});

describe('ms-pricing/effective-tariffs-job · tarifas que entran en vigencia', () => {
  const logger = () => {
    process.env.LOG_SILENT = 'true';
    return createLogger('pruebas');
  };

  it('al arrancar revisa los últimos 7 días (por si estuvo apagado a medianoche)', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T15:00:00Z') });
    const publishEffective = jest.fn(async () => 1);
    const job = new EffectiveTariffsJob({ publishEffective } as unknown as PricingRepository, logger());
    await job.start();
    job.stop();
    expect(publishEffective).toHaveBeenCalledWith('2026-11-14', '2026-11-20');
  });

  it('luego corre a las 00:05 de Ecuador revisando solo el día', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T15:00:00Z') });
    const publishEffective = jest.fn(async () => 0);
    const job = new EffectiveTariffsJob({ publishEffective } as unknown as PricingRepository, logger());
    await job.start();
    // 2026-11-21 00:05 en Ecuador = 05:05Z
    await jest.advanceTimersByTimeAsync(new Date('2026-11-21T05:05:00Z').getTime() - Date.now());
    job.stop();
    expect(publishEffective).toHaveBeenLastCalledWith('2026-11-21', '2026-11-21');
  });

  it('un error de la base no detiene la tarea', async () => {
    const job = new EffectiveTariffsJob({ publishEffective: jest.fn(async () => { throw new Error('base caída'); }) } as unknown as PricingRepository, logger());
    await expect(job.start()).resolves.toBeUndefined();
    job.stop();
  });
});
