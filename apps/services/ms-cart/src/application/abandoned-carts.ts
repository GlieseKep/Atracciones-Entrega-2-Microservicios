import { errorFields, type Logger } from '@atracciones/platform';
import type { CartRepository } from '../persistence/cart-repository';

const ABANDONED_DAYS = 30;
const INTERVAL_MS = 24 * 60 * 60_000;

/** Desactiva cada día los carritos sin cambios en 30 días. Uno con ítems `EN_PAGO` espera a Order. */
export class AbandonedCarts {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cart: CartRepository,
    private readonly logger: Logger,
  ) {}

  private async run(): Promise<void> {
    try {
      const closed = await this.cart.deactivateAbandoned(ABANDONED_DAYS);
      if (closed > 0) this.logger.info('carritos abandonados desactivados', { carritos: closed });
    } catch (error) {
      this.logger.error('no se pudieron desactivar los carritos abandonados', errorFields(error));
    }
  }

  start(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
