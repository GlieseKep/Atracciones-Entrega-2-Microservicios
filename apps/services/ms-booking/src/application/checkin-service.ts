import { AppError, hasRole, requirePrincipal, type Principal } from '@atracciones/platform';
import type { CheckinResponse } from '../contract';
import type { IdempotencyRepository, IdempotencySubject } from '../persistence/idempotency-repository';
import type { ReservationRepository, ReservationRow } from '../persistence/reservation-repository';
import { onceByKey } from './idempotency';
import type { Remote } from './remote';
import { guideName } from './reservation-mapper';
import { verifyVoucher } from './voucher';

export interface CheckinInput {
  key: string;
  id: string;
  documento: string;
  voucher: string | null;
  guiaCodigo: string | null;
  dispositivo: string | null;
}

/** Valida al turista en el punto de encuentro. Lo hacen el personal de la atracción o un socio. */
export class CheckinService {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly remote: Remote,
    private readonly secrets: { internalToken: string; voucher: string },
  ) {}

  async run(input: CheckinInput): Promise<CheckinResponse> {
    const principal = await requirePrincipal(this.secrets.internalToken);
    const subject: IdempotencySubject = { tipo: principal.tipo === 'USUARIO' ? 'USUARIO' : 'CLIENTE_API', id: Number(principal.id) };
    return onceByKey(this.idempotency, input.key, subject, 'CheckIn', input, () => this.checkIn(input, principal));
  }

  private async assertStaff(atraccionId: string, principal: Principal): Promise<void> {
    if (principal.tipo === 'API_CLIENTE' || hasRole(principal, 'ADMIN')) return;
    if (!hasRole(principal, 'OPERADOR')) throw AppError.forbidden('El check-in requiere el rol ADMIN u OPERADOR, o credenciales de socio.');
    await this.remote.assertOperatorOf(atraccionId);
  }

  private async checkIn(input: CheckinInput, principal: Principal): Promise<CheckinResponse> {
    const row: ReservationRow | null = await this.reservations.find(input.id);
    if (!row) throw AppError.notFound(`No existe la reserva ${input.id}.`, 'RESERVATION_NOT_FOUND');
    const slot = await this.remote.slot(Number(row.dis_id));
    await this.assertStaff(slot.atraccion_id, principal);
    if (row.est_codigo !== 'CONFIRMED') throw AppError.conflict('RESERVATION_NOT_CONFIRMED', `La reserva está ${row.est_codigo}.`);
    if (input.documento.toUpperCase() !== row.pax_documento) throw AppError.forbidden('El documento no es el del titular.', 'DOCUMENT_MISMATCH');
    if (input.voucher && !verifyVoucher(input.voucher, row.res_uuid, this.secrets.voucher)) throw AppError.forbidden('El código QR no es válido.', 'INVALID_VOUCHER');

    const now = new Date();
    const updated = await this.reservations.transition(
      row.res_id,
      ['CONFIRMED'],
      'CHECKED_IN',
      { res_checkin_en: now, res_checkin_documento: row.pax_documento, res_checkin_guia_codigo: input.guiaCodigo?.slice(0, 30) ?? null, res_checkin_dispositivo: input.dispositivo?.slice(0, 60) ?? null },
      () => [],
    );
    if (!updated) throw AppError.conflict('RESERVATION_NOT_CONFIRMED', 'La reserva cambió de estado.');
    const logistics = await this.remote.logisticsOrNull(slot.atraccion_id, row.gui_id === null ? null : Number(row.gui_id));
    return {
      reserva_id: row.res_uuid,
      reservation_code: row.res_codigo,
      estado: updated.est_codigo,
      titular_nombre: row.pax_nombre,
      titular_documento: row.pax_documento,
      guia_asignado: guideName(logistics),
      punto_encuentro: logistics?.punto_encuentro ?? '',
      hora_checkin: now.toISOString(),
      pase_abordar_qr: row.res_voucher_qr ?? '',
    };
  }
}
