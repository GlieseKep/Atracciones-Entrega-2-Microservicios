import { money, timeLabel } from '@atracciones/platform';
import type { ContractV2Schema } from '@atracciones/contracts';

/** Reserva tal como la devuelve Booking (proto `atracciones.booking.Reservation`). */
export interface ReservationDto {
  reservation_id: string;
  reservation_code: string;
  external_order_id: string;
  status: string;
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  boletos: { ticket_type: string; cantidad: number }[];
  total: number;
  moneda: string;
  customer: { full_name: string; email: string; phone: string; document_type: string; document_id: string };
  guia_codigo: string;
  punto_encuentro: string;
  voucher_qr_payload: string;
  checkin_en: string;
  checkin_documento: string;
  reembolso_codigo: string;
  monto_reembolsado: number;
}

type Reservation = ContractV2Schema<'ReservaConfirmadaResponseV2'>;
type Checkin = ContractV2Schema<'CheckinResponse'>;

const count = (r: ReservationDto, type: string) => r.boletos.find((b) => b.ticket_type === type)?.cantidad ?? 0;

/** `ReservaConfirmadaResponseV2` (plan §4.1). `base` es el prefijo con el que llegó la petición (`/api/v2` o `/api/v1`). */
export function toReservation(r: ReservationDto, guiaAsignado: string, base: string): Reservation {
  const adults = count(r, 'ADULT');
  const children = count(r, 'CHILD');
  const seniors = count(r, 'SENIOR');
  const students = count(r, 'STUDENT');
  const infants = count(r, 'INFANT');
  const time = timeLabel(r.hora);
  const self = `${base}/atracciones/reservas/${r.reservation_id}`;
  return {
    external_order_id: r.external_order_id,
    reservation_id: r.reservation_id,
    reservation_code: r.reservation_code,
    status: r.status as Reservation['status'],
    date: r.fecha,
    time,
    ticket_count: adults + children + seniors + students + infants,
    adult_count: adults,
    child_count: children,
    senior_count: seniors,
    student_count: students,
    infant_count: infants,
    cantidad_adultos: adults,
    cantidad_ninos: children,
    cantidad_seniors: seniors,
    cantidad_estudiantes: students,
    cantidad_infantes: infants,
    total_price: money(r.total),
    currency: r.moneda,
    fecha: r.fecha,
    hora: time,
    precio_total: money(r.total),
    moneda: r.moneda,
    estado: r.status,
    customer: {
      full_name: r.customer.full_name,
      nombre_completo: r.customer.full_name,
      email: r.customer.email,
      correo: r.customer.email,
      phone: r.customer.phone,
      telefono: r.customer.phone,
      document_type: r.customer.document_type as 'CEDULA',
      tipo_documento: r.customer.document_type as 'CEDULA',
      document_id: r.customer.document_id,
      numero_documento: r.customer.document_id,
    },
    guia_asignado: guiaAsignado,
    punto_encuentro: r.punto_encuentro,
    voucher_qr_payload: r.voucher_qr_payload,
    ...(r.reembolso_codigo ? { reembolso_id: r.reembolso_codigo, monto_reembolsado: money(r.monto_reembolsado) } : {}),
    _links: { self, checkin: `${self}/checkin`, cancel: `${self}/cancel` },
  };
}

export function toCheckin(r: ReservationDto, guiaAsignado: string): Checkin {
  return {
    reserva_id: r.reservation_id,
    reservation_code: r.reservation_code,
    estado: 'CHECKED_IN',
    titular_nombre: r.customer.full_name,
    titular_documento: r.customer.document_id,
    guia_asignado: guiaAsignado,
    punto_encuentro: r.punto_encuentro,
    hora_checkin: r.checkin_en.replace(/\.\d{3}Z$/, 'Z'),
  };
}
