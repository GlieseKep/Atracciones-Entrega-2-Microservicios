import type { Logger } from '@atracciones/platform';
import type { CartRepository } from '../persistence/cart-repository';

/**
 * Tarea periódica: desactiva los carritos sin cambios en `ttlDays` días y sin ítems en pago. Los ítems en pago no se
 * tocan: solo Order sabe si el cobro se hizo, y es quien los confirma o libera.
 */
export function startAbandonedCartSweeper(repository: CartRepository, ttlDays: number, logger: Logger, intervalMs = 3_600_000): () => Promise<void> {
  const run = async () => {
    try {
      const abandoned = await repository.abandonIdle(ttlDays);
      if (abandoned > 0) logger.info('carritos abandonados', { cantidad: abandoned, dias: ttlDays });
    } catch (error) {
      logger.error('no se pudieron cerrar los carritos abandonados', { error: String(error) });
    }
  };
  setInterval(() => void run(), intervalMs).unref();
  return run;
}
