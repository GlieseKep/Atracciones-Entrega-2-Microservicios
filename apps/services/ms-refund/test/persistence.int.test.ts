import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { RefundRepository } from '../src/persistence/refund-repository';

const K1 = '11111111-1111-4111-8111-111111111111';
const K2 = '22222222-2222-4222-8222-222222222222';

describe('ms-refund · persistencia en ms_refund (P9)', () => {
  let db: MsDatabase;
  let refunds: RefundRepository;

  beforeAll(async () => {
    db = await msDatabase('ms-refund');
    refunds = new RefundRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('reembolso completo y ReembolsoEmitido con el monto acumulado en la misma transacción', async () => {
    const refund = await refunds.emit({ id: 5, monto: 90 }, { ord_id: 11, monto: null, motivo: 'Cancelación' }, K1);
    expect(refund).toMatchObject({ pag_id: 5, monto_reembolsado: 90, reembolso_id: expect.stringMatching(/^REF-ATR-/) });
    const [event] = await db.dataSource.query(`SELECT tipo_evento, payload FROM outbox`);
    expect(event).toMatchObject({ tipo_evento: 'ReembolsoEmitido', payload: { ord_id: 11, monto: 90, monto_acumulado: 90 } });
  });

  it('un solo reembolso por el saldo: otro → 409 REFUND_EXCEEDS_BALANCE; la misma clave → null (ya existe)', async () => {
    await expect(refunds.emit({ id: 5, monto: 90 }, { ord_id: 11, monto: null, motivo: null }, K2)).rejects.toMatchObject({ status: 409, code: 'REFUND_EXCEEDS_BALANCE' });
    await expect(refunds.emit({ id: 6, monto: 50 }, { ord_id: 12, monto: null, motivo: null }, K1)).resolves.toBeNull();
    await expect(refunds.findByKey(K1)).resolves.toMatchObject({ pag_id: 5 });
  });
});
