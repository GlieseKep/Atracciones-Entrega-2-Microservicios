import { errorFields, todayIn, type Logger } from '@atracciones/platform';
import type { ScheduleRepository } from '../persistence/schedule-repository';

const WINDOW_DAYS = 90;
const INTERVAL_MS = 6 * 60 * 60_000;

/** Mantiene turnos para los próximos 90 días. Si estuvo caído, rellena al volver. */
export class SlotGenerator {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly logger: Logger,
  ) {}

  /** Genera en el momento, por ejemplo al crear un horario. */
  generate(codigo: string | null = null): Promise<number> {
    return this.schedules.generateSlots(todayIn(), WINDOW_DAYS, codigo);
  }

  private async tick(): Promise<void> {
    try {
      const created = await this.generate();
      if (created > 0) this.logger.info('turnos generados', { turnos: created });
    } catch (error) {
      this.logger.error('no se pudieron generar los turnos', errorFields(error));
    }
  }

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
