import type { IsoDate, IsoDateTime, PaginationMetadata } from './api';
import type { AttractionDetail } from './attraction';
import type { PaymentMethodCode } from './booking';
import type { RoleName } from './identity';

/** Tipos de las operaciones administrativas (GraphQL), con los nombres de cada servicio. */

/** Página normalizada para las tablas del panel. */
export interface AdminPage<T> {
  total: number;
  items: T[];
}

export interface MetadataPage<T> {
  metadata: PaginationMetadata;
  data: T[];
}

export interface PaginationPage<T> {
  pagination: PaginationMetadata;
  data: T[];
}

// Identity ---------------------------------------------------------------------

export interface RoleInfo {
  id: number;
  nombre: RoleName;
  descripcion: string;
}

export interface ApiClient {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
  creado_en: IsoDateTime;
  ultimo_uso: IsoDateTime | null;
}

export interface CreatedApiClient extends ApiClient {
  /** Se muestra una sola vez. */
  api_key: string;
}

// Catalog ----------------------------------------------------------------------

export type AttractionState = 'BORRADOR' | 'PUBLICADA' | 'INACTIVA';
export type AttractionType = 'GUIDED_TOUR' | 'ADMISSION' | 'DAY_TRIP' | 'TRANSPORT' | 'PACKAGE';

/** Atracción del listado y detalle de administración: la ficha del contrato más sus datos de edición. */
export interface AdminAttraction extends AttractionDetail {
  estado: AttractionState;
  /** Solo al cambiar el estado: `false` si los cupos no quedaron en cola para Booking. */
  stock_sincronizado?: boolean;
  tipo: AttractionType;
  ciu_id: number;
  destacada: boolean;
  categorias: string[];
  idiomas: string[];
  inclusiones: number[];
  fotos: { url: string; alt: string; orden: number }[];
  /** Valores sin mezclar para el editor. */
  operador: string;
  short_description: string | null;
  duration_hours: number;
  address: string | null;
  meeting_point: string | null;
}

export interface ItineraryStopInput {
  stop_number: number;
  time: string;
  title: string;
  description?: string;
  duration_minutes: number;
  location_name?: string;
}

/** `AtraccionRequest` de ms-catalog (crear y reemplazar). */
export interface AttractionRequest {
  name: string;
  slug?: string;
  description: string;
  short_description?: string;
  tipo: AttractionType;
  latitude: number;
  longitude: number;
  address?: string;
  meeting_point?: string;
  arrival_instructions?: string;
  duration_hours: number;
  ciu_id: number;
  operador: string;
  categorias: string[];
  idiomas: string[];
  inclusiones: number[];
  fotos: { url: string; alt: string; orden: number }[];
  itinerario: ItineraryStopInput[];
  inclusions: { includes_food: boolean; includes_transport: boolean; includes_guide: boolean };
  accessibility: { wheelchair_accessible: boolean; stroller_accessible: boolean; service_animals_allowed: boolean };
  cancellation_policy: { free_cancellation: boolean; deadline_hours: number; description?: string };
  permite_paquete: boolean;
  porcentaje_descuento_paquete: number;
  destacada: boolean;
}

export interface Operator {
  id: string;
  nombre_comercial: string;
  ruc?: string;
  telefono_emergencia?: string;
  email_soporte?: string;
  direccion: string | null;
  prov_id: number;
  activo: boolean;
}

export interface Guide {
  gui_id: number;
  codigo: string;
  nombre: string;
  credencial_mintur: string;
  operador: string;
  usu_id: number | null;
  activo: boolean;
}

export interface Inclusion {
  id: number;
  tipo: 'INCLUYE' | 'NO_INCLUYE' | 'RECOMENDACION';
  nombre: string;
  orden: number;
}

export interface PriceTable {
  attraction_id: string;
  date: IsoDate;
  currency: string;
  adult: number;
  child: number;
  senior: number;
  infant: number;
  student?: number;
}

// Inventory --------------------------------------------------------------------

export interface Schedule {
  hor_id: number;
  atraccion_id: string;
  hora: string;
  cupo: number;
  activo: boolean;
  gui_id: number | null;
}

export interface Slot {
  dis_id: number;
  atraccion_id: string;
  slot_id: string;
  fecha: IsoDate;
  hora: string;
  cupo_total: number;
  cupo_reservado: number;
  cerrada: boolean;
  gui_id: number | null;
}

export interface BlockedDate {
  atraccion_id: string;
  fecha: IsoDate;
  motivo: string;
}

export interface SlotsGuideResult {
  actualizados: number;
  slot_ids: string[];
  con_reservas: number;
}

// Payment, refund, invoicing ---------------------------------------------------

export type PaymentState = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'FALLIDO';

export interface Payment {
  id: number;
  numero: string;
  ord_id: number;
  metodo: PaymentMethodCode;
  estado: PaymentState;
  monto: number;
  referencia: string | null;
  autorizacion: string | null;
  motivo_rechazo: string | null;
  fecha: IsoDateTime;
  aprobado_en: IsoDateTime | null;
  rechazado_en: IsoDateTime | null;
}

export interface Refund {
  reembolso_id: string;
  pag_id: number;
  ord_id?: number;
  monto_reembolsado: number;
  monto_acumulado?: number;
  motivo: string | null;
  referencia: string | null;
  solicitado_en: IsoDateTime;
  procesado_en: IsoDateTime;
}

// Review, coupon, support, audit -----------------------------------------------

export interface AdminReview {
  id: number;
  atr_id: number;
  autor_nombre: string;
  anonima: boolean;
  visible: boolean;
  puntuacion: number;
  comentario: string;
  creado_en: IsoDateTime;
}

export interface Coupon {
  code: string;
  type: 'PORCENTAJE' | 'FIJO';
  value: number;
  start_date: IsoDate;
  end_date: IsoDate | null;
  max_uses: number | null;
  active: boolean;
}

export interface Agreement {
  proveedor_id: string;
  nombre_comercial?: string;
  permite_promociones: boolean;
  porcentaje_descuento_maximo: number;
  destinos_habilitados: string[];
  fecha_acuerdo: IsoDate;
  vigencia_hasta: IsoDate;
  condiciones_combo?: string;
}

export interface ContactMessage {
  id: number;
  nombre: string;
  correo: string;
  asunto: string;
  cuerpo: string;
  leido: boolean;
  creado_en: IsoDateTime;
}

export interface AuditEntry {
  id: number;
  event_id: string;
  usu_id: number | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  correlation_id: string | null;
  detalle: Record<string, unknown> | null;
  creado_en: IsoDateTime;
}

export interface ServiceHealth {
  service: string;
  status: string;
  latencyMs: number;
  databaseConnected: boolean | null;
  error: string | null;
}

export interface SystemHealth {
  status: string;
  checkedAt: IsoDateTime;
  services: ServiceHealth[];
}
