import { AppError, EsbClient, hasRole, requirePrincipal } from '@atracciones/platform';
import type { Schedule, Slot } from '../contract';
import type { ScheduleRepository } from '../persistence/schedule-repository';
import type { SlotGenerator } from './slot-generator';

/** Horarios, aforo y fechas bloqueadas. Todo es para `ADMIN`, u `OPERADOR` de la atracción. */
export class ScheduleService {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly generator: SlotGenerator,
    private readonly esb: EsbClient,
    private readonly secret: string,
  ) {}

  /**
   * Inventory no sabe de quién es cada atracción: lo responde la ruta de administración de Catalog, que con el principal
   * propagado da `403` a otro operador.
   */
  async requireStaff(codigo: string): Promise<void> {
    const principal = await requirePrincipal(this.secret);
    if (hasRole(principal, 'ADMIN')) return;
    if (!hasRole(principal, 'OPERADOR')) throw AppError.forbidden('Esta operación requiere el rol ADMIN u OPERADOR.');
    await this.esb.call('catalog', 'adminGetAttraction', { id: codigo });
  }

  /** Editar solo cambia el cupo de los turnos futuros. La hora no cambia: se crea otro horario y se desactiva este. */
  async save(horId: number, codigo: string, hora: string, cupo: number): Promise<Schedule> {
    await this.requireStaff(codigo);
    if (horId === 0) {
      const created = await this.schedules.createSchedule(codigo, hora, cupo);
      await this.generator.generate(codigo);
      return created;
    }
    const current = await this.schedules.findSchedule(horId);
    if (current.atraccion_id !== codigo) throw AppError.notFound(`No existe el horario ${horId}.`, 'SCHEDULE_NOT_FOUND');
    if (current.hora !== hora) throw AppError.conflict('SCHEDULE_TIME_IMMUTABLE', 'La hora de un horario no cambia: cree otro y desactive este.');
    return this.schedules.updateScheduleCapacity(horId, cupo);
  }

  /** Desactivar deja de generar turnos, sin tocar los existentes. */
  async setActive(horId: number, activo: boolean): Promise<Schedule> {
    const current = await this.schedules.findSchedule(horId);
    await this.requireStaff(current.atraccion_id);
    const updated = await this.schedules.setScheduleActive(horId, activo);
    if (activo) await this.generator.generate(current.atraccion_id);
    return updated;
  }

  async setCapacity(codigo: string, slotCode: string, cupoTotal: number): Promise<Slot> {
    await this.requireStaff(codigo);
    return this.schedules.setSlotCapacity(codigo, slotCode, cupoTotal);
  }

  /** Reabre los turnos del día y crea los que el generador saltó mientras estaba bloqueado. */
  async unblock(codigo: string, fecha: string): Promise<void> {
    await this.requireStaff(codigo);
    await this.schedules.unblockDate(codigo, fecha);
    await this.generator.generate(codigo);
  }
}
