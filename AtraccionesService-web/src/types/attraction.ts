import type { IsoDate, PaginationMetadata } from './api';

/** Catálogo público del contrato v3 (`atracciones-openapi-v3`). Se usan los nombres canónicos en inglés. */

/** `TarifaBaseDesglosada`: precio por tipo de boleto. */
export interface TicketPrices {
  currency: string;
  adult: number;
  child: number;
  senior: number;
  infant: number;
  student?: number;
}

export interface RatingSummary {
  score: number;
  review_count: number;
  badge_text?: string;
}

export interface RatingBreakdown {
  limpieza: number;
  servicio: number;
  calidad_precio: number;
  puntualidad: number;
}

export interface Inclusions {
  includes_food: boolean;
  includes_transport: boolean;
  includes_guide: boolean;
}

/** `AtraccionCardResponseV2`: tarjeta de listados y búsquedas. */
export interface AttractionCard {
  id: string;
  slug?: string;
  name: string;
  short_description?: string;
  city: string;
  duration: string;
  duration_hours?: number;
  price: TicketPrices;
  rating: RatingSummary;
  free_cancellation?: boolean;
  free_cancellation_hours?: number;
  inclusions: Inclusions;
  meeting_point?: string;
  photos?: string[];
  permite_paquete?: boolean;
}

export interface ItineraryStop {
  stop_number: number;
  time: string;
  title: string;
  description?: string;
  duration_minutes: number;
  location_name?: string;
}

export interface MeetingPoint {
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  arrival_instructions?: string;
  google_maps_url?: string;
}

export interface Accessibility {
  wheelchair_accessible?: boolean;
  stroller_accessible?: boolean;
  service_animals_allowed?: boolean;
}

export interface CancellationPolicy {
  free_cancellation: boolean;
  deadline_hours: number;
  description?: string;
}

export interface Provider {
  id?: string;
  nombre_comercial?: string;
  ruc?: string;
  telefono_emergencia?: string;
  email_soporte?: string;
}

/** `AtraccionDetailResponseV2`: ficha completa. */
export interface AttractionDetail {
  id: string;
  slug?: string;
  name: string;
  description: string;
  city: string;
  duration?: string;
  price: TicketPrices;
  rating: RatingSummary & { breakdown: RatingBreakdown };
  inclusions: Inclusions;
  inclusions_list?: string[];
  exclusions_list?: string[];
  itinerary: ItineraryStop[];
  meeting_point_geo: MeetingPoint;
  accessibility?: Accessibility;
  guide_languages?: string[];
  cancellation_policy?: CancellationPolicy;
  permite_paquete?: boolean;
  porcentaje_descuento_paquete?: number;
  photos?: string[];
  proveedor?: Provider;
}

export type SearchSort = 'POPULARITY' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING_DESC';

/** `SearchAtraccionesRequestV2` (más `sort`, que Catalog acepta igual que en `GET /atracciones`). */
export interface SearchRequest {
  query?: string;
  ciudad?: string;
  fecha_inicio?: IsoDate;
  fecha_fin?: IsoDate;
  categoria_id?: string;
  incluye_comida?: boolean;
  incluye_transporte?: boolean;
  incluye_guia?: boolean;
  precio_min?: number;
  precio_max?: number;
  duracion_max_horas?: number;
  idioma_guia?: string;
  accesible_silla_ruedas?: boolean;
  animales_asistencia?: boolean;
  cancelacion_gratuita?: boolean;
  sort?: SearchSort;
  page?: number;
  limit?: number;
}

export interface SearchResponse {
  request_id?: string;
  metadata: PaginationMetadata;
  data: AttractionCard[];
}

/** `CategoryFlat`. */
export interface Category {
  id: string;
  padre_id?: string | null;
  nombre: string;
  slug: string;
  incluye_comida?: boolean;
  incluye_transporte?: boolean;
  incluye_guia?: boolean;
}

export type SlotStatus = 'DISPONIBLE' | 'ULTIMOS_CUPOS' | 'AGOTADO';

/** `TimeSlotItem`. */
export interface TimeSlot {
  slot_id: string;
  time: string;
  time_24h?: string;
  total_slots: number;
  available_slots: number;
  status: SlotStatus;
  price_adult?: number;
  price_child?: number;
}

/** `DisponibilidadResponse`. */
export interface Availability {
  atraccion_id: string;
  date: IsoDate;
  total_available_slots: number;
  time_slots: TimeSlot[];
}
