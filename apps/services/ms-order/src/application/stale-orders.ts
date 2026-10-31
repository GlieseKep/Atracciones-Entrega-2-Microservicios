import { errorFields, type EsbClient, type Logger } from '@atracciones/platform';
import type { IdempotencyRepository } from '../persistence/idempotency-repository';
import type { OrderRepository } from '../persistence/order-repository';
import type { OrderService } from './order-service';

const STALE_MINUTES = 30;
const INTERVAL_MS = 5 * 60_000;

interface Payment {
  estado: string;
}

/**
 * Órdenes colgadas: si Payment dice que se aprobó, se pagan; si no, se cancelan. Así ningún ítem del carrito queda
 * `EN_PAGO` para siempre. También limpia las claves de idempotencia vencidas.
 */
export class StaleOrders {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly orders: OrderRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly service: OrderService,
    private readonly esb: EsbClient,
    private readonly logger: Logger,
  ) {}

  private async resolve(ordId: number): Promise<void> {
    const payments = await this.esb.call<Payment[]>('payment', 'listOrderPayments', { ordId });
    if (payments.some((payment) => payment.estado === 'APROBADO')) {
      await this.orders.markPaid(ordId);
      return;
    }
    await this.service.cancelPendingPayments(ordId);
    await this.orders.cancel(ordId);
  }

  private async run(): Promise<void> {
    try {
      await this.idempotency.purgeExpired();
      for (const ordId of await this.orders.staleOrders(STALE_MINUTES)) await this.resolve(ordId);
    } catch (error) {
      this.logger.error('no se pudieron revisar las órdenes colgadas', errorFields(error));
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
