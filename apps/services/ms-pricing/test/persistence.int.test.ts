import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { PricingRepository } from '../src/persistence/pricing-repository';

const CODE = 'PRhu4UBTWPBC';
const TABLE = (validFrom: string, adult: number) => ({ codigo: CODE, validFrom, prices: { ADULT: adult, CHILD: adult / 2, SENIOR: adult * 0.7, INFANT: 0 } });

describe('ms-pricing · persistencia en ms_pricing (P5, P7)', () => {
  let db: MsDatabase;
  let pricing: PricingRepository;
  const events = async () => db.dataSource.query(`SELECT tipo_evento, payload FROM outbox ORDER BY creado_en`) as Promise<{ tipo_evento: string; payload: { current_prices: { adult: number } } }[]>;

  beforeAll(async () => {
    db = await msDatabase('ms-pricing');
    pricing = new PricingRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('tarifas vigentes por fecha: la nueva versión cierra la anterior el día previo; tarifa futura no aplica antes', async () => {
    await pricing.setPriceTable(TABLE('2026-11-20', 40), '2026-11-20');
    await pricing.setPriceTable(TABLE('2026-12-01', 50), '2026-11-20');
    const before = await pricing.forDate(CODE, '2026-11-30');
    const after = await pricing.forDate(CODE, '2026-12-01');
    expect(before.find((r) => r.tar_tipo === 'ADULT')?.tar_precio).toBe('40.00');
    expect(after.find((r) => r.tar_tipo === 'ADULT')?.tar_precio).toBe('50.00');
    expect(before.find((r) => r.tar_tipo === 'ADULT')?.tar_vigente_hasta).toBe('2026-11-30');
    await expect(pricing.setPriceTable(TABLE('2026-11-25', 45), '2026-11-20')).rejects.toMatchObject({ status: 422, code: 'TARIFF_OVERLAP' });
  });

  it('outbox TARIFA_ACTUALIZADA: solo cuando la tabla rige hoy, y publishEffective la emite el día que entra en vigencia', async () => {
    const hoy = await events();
    expect(hoy.map((e) => e.tipo_evento)).toEqual(['TARIFA_ACTUALIZADA']);
    expect(hoy[0].payload.current_prices.adult).toBe(40);
    await expect(pricing.publishEffective('2026-12-01', '2026-12-01')).resolves.toBe(1);
    const all = await events();
    expect(all).toHaveLength(2);
    expect(all[1].payload.current_prices.adult).toBe(50);
  });
});
