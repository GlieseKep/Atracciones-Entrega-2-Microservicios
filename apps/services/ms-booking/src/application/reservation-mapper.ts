import { timeLabel } from '@atracciones/platform';
import type { NotificacionBooking, ReservaResponse } from '../contract';
import { MAX_NOTIFICATION_ATTEMPTS } from '../persistence/checkin-notification-repository';
import type { ReservationRow } from '../persistence/reservation-repository';
import type { Logistics, Slot } from './remote';

const PENDING_GUIDE = 'Por asignar';

export const guideName = (logistics: Logistics | null) => logistics?.guia?.nombre ?? PENDING_GUIDE;

/** Sin fila de aviso: `NO_APLICA` (compra web o sin check-in todavía). */
export function notificationStatus(row: ReservationRow): NotificacionBooking {
  if (row.nch_intentos === null || row.nch_intentos === undefined) return 'NO_APLICA';
  if (row.nch_enviado_en) return 'ENVIADA';
  return row.nch_intentos >= MAX_NOTIFICATION_ATTEMPTS ? 'FALLIDA' : 'PENDIENTE';
}

/** `ReservaConfirmadaResponseV2`, con sus alias. La moneda es siempre USD. */
export function toResponse(row: ReservationRow, slot: Slot, logistics: Logistics | null, basePath: string): ReservaResponse {
  const time = timeLabel(slot.hora);
  const total = Number(row.res_precio_total);
  const self = `${basePath}/atracciones/reservas/${row.res_uuid}`;
  return {
    external_order_id: row.ord_numero,
    reservation_id: row.res_uuid,
    reservation_code: row.res_codigo,
    status: row.est_codigo,
    date: slot.fecha,
    time,
    ticket_count: row.res_numero_tickets,
    adult_count: row.res_adultos,
    child_count: row.res_ninos,
    senior_count: row.res_seniors,
    student_count: row.res_estudiantes,
    infant_count: row.res_infantes,
    cantidad_adultos: row.res_adultos,
    cantidad_ninos: row.res_ninos,
    cantidad_seniors: row.res_seniors,
    cantidad_estudiantes: row.res_estudiantes,
    cantidad_infantes: row.res_infantes,
    total_price: total,
    currency: 'USD',
    fecha: slot.fecha,
    hora: time,
    precio_total: total,
    moneda: 'USD',
    estado: row.est_codigo,
    customer: {
      full_name: row.pax_nombre,
      nombre_completo: row.pax_nombre,
      email: row.pax_correo,
      correo: row.pax_correo,
      phone: row.pax_telefono,
      telefono: row.pax_telefono,
      document_type: row.pax_tipo_documento,
      tipo_documento: row.pax_tipo_documento,
      document_id: row.pax_documento,
      numero_documento: row.pax_documento,
    },
    guia_asignado: guideName(logistics),
    punto_encuentro: logistics?.punto_encuentro ?? '',
    voucher_qr_payload: row.res_voucher_qr ?? '',
    reembolso_id: row.res_reembolso_id ?? '',
    monto_reembolsado: Number(row.res_monto_reembolsado ?? 0),
    _links: { self, checkin: `${self}/checkin`, cancel: `${self}/cancel` },
    client_id: row.cla_id_cliente === null ? '' : String(row.cla_id_cliente),
    notificacion_booking: notificationStatus(row),
    attraction_id: slot.atraccion_id,
    attraction_name: logistics?.nombre ?? '',
    canal: row.res_canal,
  };
}
