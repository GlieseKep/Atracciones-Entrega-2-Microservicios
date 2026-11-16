import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { parseAgreement } from '../src/application/agreement';
import { AgreementRepository } from '../src/persistence/agreement-repository';

describe('ms-coupon · persistencia del acuerdo en ms_coupon (P11)', () => {
  let db: MsDatabase;
  let agreements: AgreementRepository;

  beforeAll(async () => {
    db = await msDatabase('ms-coupon');
    agreements = new AgreementRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('lectura del acuerdo que deja la migración', async () => {
    const { row, cityIds } = await agreements.get();
    expect(row).toMatchObject({ apr_id: expect.anything(), apr_permite_promociones: expect.any(Boolean) });
    expect(Array.isArray(cityIds)).toBe(true);
  });

  it('actualización: guarda permite, porcentaje, fecha del acuerdo y los destinos (ciu_id)', async () => {
    const { row } = await agreements.get();
    await agreements.update(row.apr_id, parseAgreement({ permite_promociones: true, porcentaje_descuento_maximo: 20, vigencia_hasta: '2027-12-31', condiciones_combo: 'Mínimo 2 servicios' }), '2026-11-20', [1, 3]);
    const after = await agreements.get();
    expect(after.row).toMatchObject({ apr_permite_promociones: true, apr_porcentaje_descuento_max: '20.00', apr_fecha_acuerdo: '2026-11-20', apr_condiciones_combo: 'Mínimo 2 servicios' });
    expect([...after.cityIds].sort()).toEqual([1, 3]);
  });
});
