import { AppError, type EsbClient } from '@atracciones/platform';
import type { CardData, StartPaymentResponse } from '../contract';
import type { OrderRepository } from '../persistence/order-repository';
import type { OrderService } from './order-service';
import type { PaymentMethods } from './payment-methods';

interface Payment {
  id: number;
  estado: string;
}

/** Inicia el cobro. Booking lo llama cuando los cupos ya están descontados. */
export class PaymentFlow {
  constructor(
    private readonly orders: OrderRepository,
    private readonly service: OrderService,
    private readonly methods: PaymentMethods,
    private readonly esb: EsbClient,
  ) {}

  /**
   * Una orden rechazada queda `CANCELADA`, así que cada orden tiene un solo intento: un reintento repite el mismo número y
   * Payment devuelve el pago guardado. Los datos de tarjeta pasan a Payment sin guardarse aquí.
   */
  async start(numero: string, tarjeta: CardData | null): Promise<StartPaymentResponse> {
    const row = await this.service.requireByNumber(numero);
    if (row.est_codigo !== 'CREADA' && row.est_codigo !== 'PAGADA') throw AppError.conflict('ORDER_NOT_PAYABLE', `La orden está ${row.est_codigo}.`);
    const ordId = Number(row.ord_id);
    if (Number(row.ord_total) === 0) {
      await this.orders.markPaid(ordId);
      return { pag_id: 0, estado_pago: 'APROBADO', estado_orden: 'PAGADA' };
    }
    const payment = await this.esb.call<Payment>('payment', 'createPayment', {
      numero: `PAG-${numero}-1`,
      ord_id: ordId,
      metodo: await this.methods.codeOf(row.mpa_id),
      monto: Number(row.ord_total),
      moneda: row.ord_moneda,
      canal: row.cla_id === null ? 'WEB' : 'B2B',
      ...(tarjeta ? { tarjeta } : {}),
    });
    // Una venta B2B se aprueba al registrarse: no espera al evento para que Booking responda `CONFIRMED`.
    if (payment.estado === 'APROBADO') await this.orders.markPaid(ordId);
    const current = await this.service.requireByNumber(numero);
    return { pag_id: payment.id, estado_pago: payment.estado, estado_orden: current.est_codigo };
  }
}
