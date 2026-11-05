import { addDays, AppError, EsbClient, hasRole, requirePrincipal, todayIn } from '@atracciones/platform';
import type { Schedule, Slot, SlotsGuideResult } from '../contract';
import type { ScheduleRepository, SlotRange } from '../persistence/schedule-repository';
import { WINDOW_DAYS, type SlotGenerator } from './slot-generator';

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

  /**
   * El guía es un ID de Catalog: Inventory no conoce a los guías. Catalog responde 404 `GUIDE_NOT_FOUND` si no existe,
   * está inactivo o es de otro operador que el de la atracción (publicada o no).
   */
  private async assertGuide(codigo: string, guiId: number | null): Promise<void> {
    if (guiId !== null) await this.esb.call('catalog', 'getAttractionGuide', { id: codigo, guiId });
  }

  /**
   * Editar cambia el cupo y el guía de los turnos futuros (los días con otro guía elegido a mano lo conservan). La hora
   * no cambia: se crea otro horario y se desactiva este.
   */
  async save(horId: number, codigo: string, hora: string, cupo: number, guiId: number | null): Promise<Schedule> {
    await this.requireStaff(codigo);
    await this.assertGuide(codigo, guiId);
    if (horId === 0) {
      const created = await this.schedules.createSchedule(codigo, hora, cupo, guiId);
      await this.generator.generate(codigo);
      return created;
    }
    const current = await this.schedules.findSchedule(horId);
    if (current.atraccion_id !== codigo) throw AppError.notFound(`No existe el horario ${horId}.`, 'SCHEDULE_NOT_FOUND');
    if (current.hora !== hora) throw AppError.conflict('SCHEDULE_TIME_IMMUTABLE', 'La hora de un horario no cambia: cree otro y desactive este.');
    return this.schedules.updateSchedule(horId, cupo, guiId, todayIn());
  }

  /** Guía de un día concreto. `null` lo devuelve al guía del horario. */
  async setSlotGuide(codigo: string, slotCode: string, guiId: number | null): Promise<Slot> {
    await this.requireStaff(codigo);
    await this.assertGuide(codigo, guiId);
    return this.schedules.setSlotGuide(codigo, slotCode, guiId);
  }

  /**
   * Guía de los turnos de un rango (hoy en adelante, dentro de la ventana de turnos generados). `null` los devuelve al
   * guía de su horario. Las reservas ya hechas conservan su guía: solo cambian las compras siguientes.
   */
  async setSlotsGuide(range: SlotRange, guiId: number | null): Promise<SlotsGuideResult> {
    const today = todayIn();
    const limit = addDays(today, WINDOW_DAYS);
    if (range.desde < today) throw AppError.validation(`'desde' debe ser hoy (${today}) o posterior.`, [{ name: 'desde', reason: 'Fecha pasada.' }]);
    if (range.desde > range.hasta) throw AppError.validation("'desde' no puede ser posterior a 'hasta'.", [{ name: 'desde', reason: "Posterior a 'hasta'." }]);
    if (range.hasta > limit) {
      throw AppError.validation(`Solo hay turnos hasta el ${limit}: 'hasta' no puede ser posterior.`, [{ name: 'hasta', reason: `Máximo ${limit}.` }], 'RANGE_BEYOND_WINDOW');
    }
    await this.requireStaff(range.codigo);
    if (range.horId !== 0) {
      const schedule = await this.schedules.findSchedule(range.horId);
      if (schedule.atraccion_id !== range.codigo) throw AppError.notFound(`No existe el horario ${range.horId}.`, 'SCHEDULE_NOT_FOUND');
    }
    await this.assertGuide(range.codigo, guiId);
    return this.schedules.setSlotsGuide(range, guiId, today);
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
