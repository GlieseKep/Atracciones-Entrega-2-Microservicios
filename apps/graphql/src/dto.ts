/** Respuestas de los servicios tal como llegan por el ESB (snake_case, como en sus bases y protos). */

export interface RatingDto {
  puntuacion: number;
  total_resenas: number;
  limpieza: number;
  servicio: number;
  calidad_precio: number;
  puntualidad: number;
}

export interface AttractionSummaryDto {
  uuid: string;
  codigo_publico: string;
  slug: string;
  nombre: string;
  descripcion_corta: string;
  ciudad: string;
  duracion_horas: number;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
  punto_encuentro: string;
  cancelacion_gratuita: boolean;
  cancelacion_horas_limite: number;
  permite_paquete: boolean;
  porcentaje_descuento_paquete: number;
  fotos: string[];
  calificacion: RatingDto;
}

export interface AttractionDetailDto extends AttractionSummaryDto {
  descripcion: string;
  pe_latitud: number;
  pe_longitud: number;
  pe_instrucciones: string | null;
  pe_google_maps_url: string | null;
  accesible_silla_ruedas: boolean;
  accesible_carriola: boolean;
  admite_animales_asistencia: boolean;
  cancelacion_descripcion: string | null;
  idiomas: string[];
  inclusiones: string[];
  exclusiones: string[];
  itinerario: { numero_parada: number; hora: string; titulo: string; descripcion: string | null; duracion_minutos: number; nombre_ubicacion: string | null }[];
  proveedor: { codigo: string; nombre_comercial: string; ruc: string; telefono_emergencia: string; email_soporte: string };
}

export interface CategoryNodeDto {
  codigo: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
  icono: string | null;
  orden: number;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
  subcategorias: CategoryNodeDto[];
}

export interface TariffDto {
  atraccion_codigo: string;
  moneda: string;
  adult: number;
  child: number;
  senior: number;
  infant: number;
  student: number;
  has_student: boolean;
}

export interface TimeSlotDto {
  fecha: string;
  hora: string;
  cupos_totales: number;
  cupos_disponibles: number;
  precio_adulto: number;
  precio_nino: number;
  guia_codigo: string;
}

export interface ProfileDto {
  id: string;
  email: string;
  nombre_completo: string;
  tipo: string;
  estado: string;
  roles: string[];
  creado_en: string;
  actualizado_en: string;
}

export interface BillingDto {
  tipo_documento: string;
  numero_documento: string;
  razon_social: string;
  email: string;
  telefono: string | null;
  direccion: string | null;
  actualizado_en: string;
}

export interface TicketDto {
  ticket_type: string;
  cantidad: number;
}

/** Proto `atracciones.booking.Reservation`. */
export interface ReservationDto {
  reservation_id: string;
  reservation_code: string;
  external_order_id: string;
  status: string;
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  boletos: TicketDto[];
  total: number;
  moneda: string;
  customer: { full_name: string; email: string; phone: string; document_type: string; document_id: string };
  passengers: { full_name: string; document_id: string; ticket_type: string }[];
  guia_codigo: string;
  punto_encuentro: string;
  observaciones: string;
  voucher_qr_payload: string;
  cancelable_hasta: string;
  checkin_en: string;
  checkin_documento: string;
  cancelado_en: string;
  reembolso_codigo: string;
  monto_reembolsado: number;
  principal_tipo: string;
  principal_id: string;
  creado_en: string;
  cancelacion_motivo: string;
  cancelacion_solicitante: string;
}

/** Proto `atracciones.order.OrderSummary`. */
export interface OrderSummaryDto {
  id: string;
  external_order_id: string;
  estado: string;
  estado_saga: string;
  metodo_pago: string;
  total: number;
  moneda: string;
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  boletos: number;
  principal_tipo: string;
  principal_id: string;
  creado_en: string;
  actualizado_en: string;
  correlation_id: string;
}

export interface PaymentDto {
  pago_id: string;
  orden_id?: string;
  metodo_pago: string;
  estado: string;
  monto: number;
  moneda?: string;
  reembolsado: number;
  referencia_pasarela: string;
  motivo_rechazo: string;
  creado_en: string;
  procesado_en: string;
  reembolsos: { codigo: string; monto: number; motivo: string; solicitante: string; estado: string; emitido_en: string }[];
}

export interface InvoiceDto {
  id: string;
  tipo_comprobante: string;
  numero: string;
  clave_acceso: string;
  estado_sri: string;
  numero_autorizacion: string;
  fecha_autorizacion: string;
  intentos: number;
  total: number;
}

/** Proto `atracciones.order.OrderDetail`. */
export interface OrderDetailDto {
  orden: OrderSummaryDto;
  lineas: { atraccion_codigo: string; fecha: string; hora: string; boletos: { ticket_type: string; cantidad: number; precio_unitario: number }[] }[];
  pasos: { paso: string; accion: string; resultado: string; detalle: string; creado_en: string }[];
  pagos: PaymentDto[];
  facturas: InvoiceDto[];
}

/** Proto `atracciones.order.OrderResponse`: la respuesta guardada de la saga. */
export interface OrderResponseDto {
  status: number;
  reserva: ReservationDto | null;
  problem: { code: string; title: string; detail: string; correlation_id: string; timestamp: string; invalid_params: { name: string; reason: string }[] } | null;
  guia_asignado: string;
}

export interface CartDto {
  id: string | null;
  estado: string;
  items: { id: string; atraccion_codigo: string; fecha: string; hora: string; boletos: TicketDto[]; agregado_en: string }[];
  actualizado_en: string | null;
  expira_en: string | null;
}

export interface AdminSlotDto {
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  cupos_totales: number;
  cupos_reservados: number;
  cupos_disponibles: number;
  cerrado: boolean;
  guia_codigo: string;
}

export interface Page<T> {
  total: number;
  items: T[];
}
