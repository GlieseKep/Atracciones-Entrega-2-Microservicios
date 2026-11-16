import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { PaymentRepository } from '../src/persistence/payment-repository';

describe('ms-payment · persistencia en ms_payment (P7)', () => {
  let db: MsDatabase;
  let payments: PaymentRepository;
  const outbox = async (agregado: string) => (await db.dataSource.query(`SELECT tipo_evento FROM outbox WHERE agregado_id = $1 ORDER BY creado_en`, [agregado])).map((r: { tipo_evento: string }) => r.tipo_evento);

  beforeAll(async () => {
    db = await msDatabase('ms-payment');
    payments = new PaymentRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('venta B2B: el pago se aprueba al registrarse con PagoAprobado en la misma transacción; el número repetido no duplica', async () => {
    const input = { numero: 'PAG-ORD-1-1', ord_id: 1, metodo: 'CREDIT_CARD', monto: 90, moneda: 'USD', canal: 'B2B', tarjeta: null } as never;
    const first = await payments.create(input);
    expect(first).toMatchObject({ created: true, payment: { estado: 'APROBADO' } });
    await expect(payments.create(input)).resolves.toMatchObject({ created: false });
    expect(await outbox('PAG-ORD-1-1')).toEqual(['PagoAprobado']);
  });

  it('pago web PENDIENTE: rechazado una sola vez con PagoRechazado; un resultado tardío no cambia nada', async () => {
    const { payment } = await payments.create({ numero: 'PAG-ORD-2-1', ord_id: 2, metodo: 'TRANSFER', monto: 45, moneda: 'USD', canal: 'WEB', tarjeta: null } as never);
    expect(payment.estado).toBe('PENDIENTE');
    await expect(payments.applyResult(payment.id, { aprobado: false, motivo: 'Fondos insuficientes' })).resolves.toMatchObject({ applied: true, payment: { estado: 'RECHAZADO' } });
    await expect(payments.applyResult(payment.id, { aprobado: true, referencia: null, autorizacion: null })).resolves.toMatchObject({ applied: false });
    expect(await outbox('PAG-ORD-2-1')).toEqual(['PagoRechazado']);
  });
});
