import { addDays, errorFields, todayIn, zonedToUtc, type Logger } from '@atracciones/platform';
import type { PricingRepository } from '../persistence/pricing-repository';

/** Al arrancar se revisan estos días, por si el servicio estuvo apagado a medianoche. */
const STARTUP_DAYS = 7;

/**
 * Una tarifa futura no produce ningún cambio el día que empieza: este proceso publica `TARIFA_ACTUALIZADA` para que
 * Catalog tenga el precio de hoy. Corre al arrancar y a las 00:05. Repetir un evento no hace daño: trae la tabla completa.
 */
export class EffectiveTariffsJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pricing: PricingRepository,
    private readonly logger: Logger,
  ) {}

  private async run(days: number): Promise<void> {
    const today = todayIn();
    try {
      const published = await this.pricing.publishEffective(addDays(today, 1 - days), today);
      if (published > 0) this.logger.info('tarifas en vigencia publicadas', { atracciones: published });
    } catch (error) {
      this.logger.error('no se pudieron publicar las tarifas en vigencia', errorFields(error));
    }
  }

  private schedule(): void {
    const next = zonedToUtc(addDays(todayIn(), 1), '00:05');
    this.timer = setTimeout(() => void this.run(1).finally(() => this.schedule()), next.getTime() - Date.now());
    this.timer.unref();
  }

  async start(): Promise<void> {
    await this.run(STARTUP_DAYS);
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
