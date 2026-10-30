import { durationLabel, money, slotId, timeLabel } from '@atracciones/platform';
import type { ContractV2Schema } from '@atracciones/contracts';

/** Formas internas que devuelven Catalog e Inventory (a través del ESB). */
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

export interface CategoryFlatDto extends Omit<CategoryNodeDto, 'subcategorias'> {
  padre_codigo: string | null;
}

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
}

export interface PromotionAgreementDto {
  proveedor_id: string;
  nombre_comercial: string;
  permite_promociones: boolean;
  porcentaje_descuento_maximo: number;
  destinos_habilitados: string[];
  fecha_acuerdo: string | null;
  vigencia_hasta: string;
  condiciones_combo: string | null;
}

type CategoryTreeNode = ContractV2Schema<'CategoryTreeNode'>;
type CategoryFlat = ContractV2Schema<'CategoryFlat'>;
type Card = ContractV2Schema<'AtraccionCardResponseV2'>;
type Detail = ContractV2Schema<'AtraccionDetailResponseV2'>;
type Price = ContractV2Schema<'TarifaBaseDesglosada'>;
type TimeSlot = ContractV2Schema<'TimeSlotItem'>;
type Availability = ContractV2Schema<'DisponibilidadResponse'>;
type Agreement = ContractV2Schema<'PromocionesContratoResponse'>;

/** Agrega `key: value` solo si el valor existe (el contrato no admite `null` en campos no anulables). */
const opt = <K extends string, V>(key: K, value: V | null | undefined) => (value === null || value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, V>));

export function toCategoryNode(c: CategoryNodeDto): CategoryTreeNode {
  return {
    id: c.codigo,
    nombre: c.nombre,
    slug: c.slug,
    ...opt('descripcion', c.descripcion),
    ...opt('icono', c.icono),
    incluye_comida: c.incluye_comida,
    incluye_transporte: c.incluye_transporte,
    incluye_guia: c.incluye_guia,
    orden: c.orden,
    subcategorias: c.subcategorias.map(toCategoryNode),
  };
}

export function toCategoryFlat(c: CategoryFlatDto): CategoryFlat {
  return {
    id: c.codigo,
    padre_id: c.padre_codigo,
    nombre: c.nombre,
    slug: c.slug,
    incluye_comida: c.incluye_comida,
    incluye_transporte: c.incluye_transporte,
    incluye_guia: c.incluye_guia,
  };
}

export function toPrice(t: TariffDto): Price {
  return {
    currency: t.moneda,
    adult: money(t.adult),
    child: money(t.child),
    senior: money(t.senior),
    infant: money(t.infant),
    ...(t.has_student ? { student: money(t.student) } : {}),
    adulto: money(t.adult),
    nino: money(t.child),
    tercera_edad: money(t.senior),
    infante: money(t.infant),
    ...(t.has_student ? { estudiante: money(t.student) } : {}),
    moneda: t.moneda,
  };
}

/** Texto de la insignia según la puntuación (escala 0–10). */
export function badgeText(score: number, reviews: number): string {
  if (reviews === 0) return 'Nuevo';
  if (score >= 9) return 'Excepcional';
  if (score >= 8) return 'Fabuloso';
  if (score >= 7) return 'Muy bueno';
  if (score >= 6) return 'Bueno';
  return 'Aceptable';
}

const ratingSummary = (r: RatingDto) => ({ score: r.puntuacion, review_count: r.total_resenas, badge_text: badgeText(r.puntuacion, r.total_resenas) });

export function toCard(a: AttractionSummaryDto, tariff: TariffDto): Card {
  const price = toPrice(tariff);
  const rating = ratingSummary(a.calificacion);
  const inclusions = { incluye_comida: a.incluye_comida, incluye_transporte: a.incluye_transporte, incluye_guia: a.incluye_guia };
  const duration = durationLabel(a.duracion_horas);
  return {
    id: a.codigo_publico,
    slug: a.slug,
    name: a.nombre,
    short_description: a.descripcion_corta,
    city: a.ciudad,
    duration,
    duration_hours: a.duracion_horas,
    price,
    rating,
    free_cancellation: a.cancelacion_gratuita,
    free_cancellation_hours: a.cancelacion_horas_limite,
    inclusions,
    meeting_point: a.punto_encuentro,
    photos: a.fotos,
    permite_paquete: a.permite_paquete,
    nombre: a.nombre,
    descripcion_corta: a.descripcion_corta,
    ciudad: a.ciudad,
    duracion: duration,
    precio: price,
    calificacion: rating,
    cancelacion_gratuita: a.cancelacion_gratuita,
    inclusiones: inclusions,
    punto_encuentro: a.punto_encuentro,
  };
}

export function toDetail(a: AttractionDetailDto, tariff: TariffDto): Detail {
  const card = toCard(a, tariff);
  const r = a.calificacion;
  const rating = {
    ...ratingSummary(r),
    breakdown: {
      limpieza: r.limpieza, servicio: r.servicio, calidad_precio: r.calidad_precio, puntualidad: r.puntualidad,
      cleanliness: r.limpieza, service_score: r.servicio, value_for_money: r.calidad_precio, punctuality: r.puntualidad,
    },
  };
  const geo = {
    address: a.punto_encuentro,
    city: a.ciudad,
    latitude: a.pe_latitud,
    longitude: a.pe_longitud,
    ...opt('arrival_instructions', a.pe_instrucciones),
    google_maps_url: a.pe_google_maps_url ?? `https://maps.google.com/?q=${a.pe_latitud},${a.pe_longitud}`,
    direccion: a.punto_encuentro,
    ciudad: a.ciudad,
    latitud: a.pe_latitud,
    longitud: a.pe_longitud,
    ...opt('instrucciones_llegada', a.pe_instrucciones),
  };
  const itinerary = a.itinerario.map((p) => ({
    stop_number: p.numero_parada,
    time: timeLabel(p.hora),
    title: p.titulo,
    ...opt('description', p.descripcion),
    duration_minutes: p.duracion_minutos,
    ...opt('location_name', p.nombre_ubicacion),
    numero_parada: p.numero_parada,
    hora: timeLabel(p.hora),
    titulo: p.titulo,
    ...opt('descripcion', p.descripcion),
    duracion_minutos: p.duracion_minutos,
    ...opt('nombre_ubicacion', p.nombre_ubicacion),
  }));
  const accessibility = {
    wheelchair_accessible: a.accesible_silla_ruedas,
    stroller_accessible: a.accesible_carriola,
    service_animals_allowed: a.admite_animales_asistencia,
    accesible_silla_ruedas: a.accesible_silla_ruedas,
    accesible_carriola: a.accesible_carriola,
    admite_animales_asistencia: a.admite_animales_asistencia,
  };
  const cancellation = {
    free_cancellation: a.cancelacion_gratuita,
    deadline_hours: a.cancelacion_horas_limite,
    ...opt('description', a.cancelacion_descripcion),
    cancelacion_gratuita: a.cancelacion_gratuita,
    horas_limite: a.cancelacion_horas_limite,
    ...opt('descripcion', a.cancelacion_descripcion),
  };
  return {
    id: a.codigo_publico,
    uuid: a.uuid,
    slug: a.slug,
    name: a.nombre,
    description: a.descripcion,
    city: a.ciudad,
    duration: card.duration,
    price: card.price,
    rating,
    inclusions: card.inclusions,
    inclusions_list: a.inclusiones,
    exclusions_list: a.exclusiones,
    itinerary,
    meeting_point_geo: geo,
    accessibility,
    guide_languages: a.idiomas,
    cancellation_policy: cancellation,
    permite_paquete: a.permite_paquete,
    porcentaje_descuento_paquete: a.porcentaje_descuento_paquete,
    photos: a.fotos,
    proveedor: {
      id: a.proveedor.codigo,
      nombre_comercial: a.proveedor.nombre_comercial,
      ruc: a.proveedor.ruc,
      telefono_emergencia: a.proveedor.telefono_emergencia,
      email_soporte: a.proveedor.email_soporte,
    },
    nombre: a.nombre,
    descripcion: a.descripcion,
    ciudad: a.ciudad,
    duracion: card.duration,
    precio: card.price,
    calificacion: rating,
    inclusiones: card.inclusions,
    punto_encuentro_geo: geo,
    itinerario: itinerary,
    accesibilidad: accessibility,
    politica_cancelacion: cancellation,
  };
}

/** Semáforo de aforo del contrato: AGOTADO (0), ULTIMOS_CUPOS (1 a 3) o DISPONIBLE. */
export const slotState = (available: number): TimeSlot['estado'] => (available <= 0 ? 'AGOTADO' : available <= 3 ? 'ULTIMOS_CUPOS' : 'DISPONIBLE');

export function toTimeSlot(t: TimeSlotDto): TimeSlot {
  const label = timeLabel(t.hora);
  return {
    slot_id: slotId(t.fecha, t.hora),
    time: label,
    hora: label,
    time_24h: t.hora,
    hora_24h: t.hora,
    cupos_totales: t.cupos_totales,
    cupos_disponibles: t.cupos_disponibles,
    estado: slotState(t.cupos_disponibles),
    precio_adulto_slot: money(t.precio_adulto),
    precio_nino_slot: money(t.precio_nino),
  };
}

export function toAvailability(codigo: string, fecha: string, turnos: TimeSlotDto[]): Availability {
  const slots = turnos.map(toTimeSlot);
  const total = turnos.reduce((sum, t) => sum + t.cupos_disponibles, 0);
  return { atraccion_id: codigo, date: fecha, fecha, total_available_slots: total, total_cupos_disponibles: total, time_slots: slots, turnos: slots };
}

export function toAgreement(a: PromotionAgreementDto): Agreement {
  return {
    proveedor_id: a.proveedor_id,
    nombre_comercial: a.nombre_comercial,
    permite_promociones: a.permite_promociones,
    porcentaje_descuento_maximo: a.porcentaje_descuento_maximo,
    destinos_habilitados: a.destinos_habilitados,
    ...opt('fecha_acuerdo', a.fecha_acuerdo),
    vigencia_hasta: a.vigencia_hasta,
    ...opt('condiciones_combo', a.condiciones_combo),
  };
}
