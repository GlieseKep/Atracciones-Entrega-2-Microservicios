import { createLogger, type EsbClient } from '@atracciones/platform';
import type { AgreementRepository } from '../persistence/agreement-repository';
import { AgreementService, parseAgreement } from './agreement';

process.env.LOG_SILENT = 'true';
const logger = createLogger('pruebas');

const ROW = { apr_id: 1, apr_proveedor_codigo: 'TOURGIRLS', apr_nombre_comercial: 'TourGirls', apr_permite_promociones: true, apr_porcentaje_descuento_max: '15.00', apr_fecha_acuerdo: '2026-11-01', apr_vigencia_hasta: '2027-12-31', apr_condiciones_combo: null };

function setup(row: Record<string, unknown> = ROW, cityIds: number[] = [1], esb: (op: string) => unknown = (op) => (op === 'getCities' ? [{ id: 1, nombre: 'Quito' }] : { resueltas: [{ ciudades: [{ id: 2, nombre: 'Baños' }] }], no_encontrados: [] })) {
  const update = jest.fn(async () => undefined);
  const repo = { get: jest.fn(async () => ({ row, cityIds })), update } as unknown as AgreementRepository;
  const call = jest.fn(async (_s: string, op: string) => esb(op));
  return { service: new AgreementService(repo, { call } as unknown as EsbClient, logger), update, call };
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ms-coupon/agreement · P11 acuerdo de promociones', () => {
  it('lectura con los campos del contrato y destinos por nombre', async () => {
    await expect(setup().service.get()).resolves.toEqual({ proveedor_id: 'TOURGIRLS', nombre_comercial: 'TourGirls', permite_promociones: true, porcentaje_descuento_maximo: 15, destinos_habilitados: ['Quito'], fecha_acuerdo: '2026-11-01', vigencia_hasta: '2027-12-31' });
  });

  it('actualización válida: resuelve los destinos en Location y guarda sus ciu_id', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    const { service, update } = setup();
    await service.update(parseAgreement({ permite_promociones: true, porcentaje_descuento_maximo: 20, destinos_habilitados: ['Baños'] }));
    expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ permite: true, porcentaje: 20 }), '2026-11-20', [2]);
  });

  it('porcentaje fuera de 0–50 o permite_promociones no booleano → 400', () => {
    expect(() => parseAgreement({ permite_promociones: true, porcentaje_descuento_maximo: 51 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseAgreement({ permite_promociones: 'si', porcentaje_descuento_maximo: 10 })).toThrow(expect.objectContaining({ invalidParams: [expect.objectContaining({ name: 'permite_promociones' })] }));
  });

  it('sin promociones el descuento es 0; destino desconocido → 400 DESTINATION_NOT_FOUND', async () => {
    expect(parseAgreement({ permite_promociones: false, porcentaje_descuento_maximo: 30 }).porcentaje).toBe(0);
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    const { service } = setup(ROW, [], () => ({ resueltas: [], no_encontrados: ['Atlantis'] }));
    await expect(service.update(parseAgreement({ permite_promociones: true, porcentaje_descuento_maximo: 10, destinos_habilitados: ['Atlantis'] }))).rejects.toMatchObject({ code: 'DESTINATION_NOT_FOUND' });
  });

  it('vigencia_hasta anterior a hoy → 400', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    await expect(setup().service.update(parseAgreement({ permite_promociones: true, porcentaje_descuento_maximo: 10, vigencia_hasta: '2026-11-19' }))).rejects.toMatchObject({ status: 400, invalidParams: [expect.objectContaining({ name: 'vigencia_hasta' })] });
  });
});
