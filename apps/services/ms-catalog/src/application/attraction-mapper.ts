import { durationLabel, timeLabel } from '@atracciones/platform';
import type { AttractionChildren, AttractionRow } from '../persistence/attraction-repository';

const amount = (value: string | null) => Number(value ?? 0);

function price(row: AttractionRow) {
  const adult = amount(row.atr_precio_adulto);
  const child = amount(row.atr_precio_nino);
  const senior = amount(row.atr_precio_senior);
  const infant = amount(row.atr_precio_infante);
  const student = row.atr_precio_estudiante === null ? {} : { student: Number(row.atr_precio_estudiante), estudiante: Number(row.atr_precio_estudiante) };
  return { currency: row.atr_moneda, adult, child, senior, infant, adulto: adult, nino: child, tercera_edad: senior, infante: infant, moneda: row.atr_moneda, ...student };
}

function badge(score: number, reviews: number) {
  if (reviews === 0) return {};
  if (score >= 9) return { badge_text: 'Excepcional' };
  if (score >= 8) return { badge_text: 'Muy bueno' };
  return score >= 7 ? { badge_text: 'Bueno' } : {};
}

function ratingSummary(row: AttractionRow) {
  const score = Number(row.atr_calificacion_promedio);
  return { score, review_count: row.atr_numero_resenas, ...badge(score, row.atr_numero_resenas) };
}

function rating(row: AttractionRow) {
  const limpieza = Number(row.atr_calif_limpieza);
  const servicio = Number(row.atr_calif_servicio);
  const calidadPrecio = Number(row.atr_calif_calidad_precio);
  const puntualidad = Number(row.atr_calif_puntualidad);
  return {
    ...ratingSummary(row),
    breakdown: {
      limpieza,
      servicio,
      calidad_precio: calidadPrecio,
      puntualidad,
      cleanliness: limpieza,
      service_score: servicio,
      value_for_money: calidadPrecio,
      punctuality: puntualidad,
    },
  };
}

const inclusions = (row: AttractionRow) => ({
  includes_food: row.atr_incluye_comida,
  includes_transport: row.atr_incluye_transporte,
  includes_guide: row.atr_incluye_guia,
  incluye_comida: row.atr_incluye_comida,
  incluye_transporte: row.atr_incluye_transporte,
  incluye_guia: row.atr_incluye_guia,
});

const optional = <K extends string>(name: K, value: string | null) => (value === null ? {} : ({ [name]: value } as Record<K, string>));

export const meetingPoint = (row: AttractionRow) => row.atr_punto_encuentro ?? row.atr_direccion ?? '';

/** Datos que ya se cargaron en lote, por atracción. */
export function childrenOf(children: AttractionChildren, atrId: string): AttractionChildren {
  return {
    fotos: children.fotos.filter((row) => row.atr_id === atrId),
    itinerario: children.itinerario.filter((row) => row.atr_id === atrId),
    inclusiones: children.inclusiones.filter((row) => row.atr_id === atrId),
    idiomas: children.idiomas.filter((row) => row.atr_id === atrId),
    categorias: children.categorias.filter((row) => row.atr_id === atrId),
  };
}

/** `AtraccionCardResponseV2`. */
export function toCard(row: AttractionRow, city: string, photos: string[]) {
  const hours = Number(row.atr_duracion_horas);
  const duration = durationLabel(hours);
  const priceTable = price(row);
  const summary = ratingSummary(row);
  const flags = inclusions(row);
  const point = meetingPoint(row);
  return {
    id: row.atr_codigo,
    slug: row.atr_slug,
    name: row.atr_nombre,
    ...optional('short_description', row.atr_descripcion_corta),
    city,
    duration,
    duration_hours: hours,
    price: priceTable,
    rating: summary,
    free_cancellation: row.atr_cancelacion_gratuita,
    free_cancellation_hours: row.atr_horas_cancelacion,
    inclusions: flags,
    meeting_point: point,
    photos,
    permite_paquete: row.atr_permite_paquete,
    nombre: row.atr_nombre,
    ...optional('descripcion_corta', row.atr_descripcion_corta),
    ciudad: city,
    duracion: duration,
    precio: priceTable,
    calificacion: summary,
    cancelacion_gratuita: row.atr_cancelacion_gratuita,
    inclusiones: flags,
    punto_encuentro: point,
  };
}

function itineraryStop(stop: AttractionChildren['itinerario'][number]) {
  const time = timeLabel(stop.iti_hora);
  return {
    stop_number: stop.iti_numero_parada,
    time,
    title: stop.iti_titulo,
    ...optional('description', stop.iti_descripcion),
    duration_minutes: stop.iti_duracion_minutos,
    ...optional('location_name', stop.iti_nombre_ubicacion),
    numero_parada: stop.iti_numero_parada,
    hora: time,
    titulo: stop.iti_titulo,
    ...optional('descripcion', stop.iti_descripcion),
    duracion_minutos: stop.iti_duracion_minutos,
    ...optional('nombre_ubicacion', stop.iti_nombre_ubicacion),
  };
}

/** `AtraccionDetailResponseV2`. */
export function toDetail(row: AttractionRow, city: string, children: AttractionChildren) {
  const latitude = Number(row.atr_latitud);
  const longitude = Number(row.atr_longitud);
  const address = row.atr_direccion ?? meetingPoint(row);
  const duration = durationLabel(Number(row.atr_duracion_horas));
  const priceTable = price(row);
  const fullRating = rating(row);
  const flags = inclusions(row);
  const itinerary = children.itinerario.map(itineraryStop);
  const geo = {
    address,
    city,
    latitude,
    longitude,
    ...optional('arrival_instructions', row.atr_instrucciones_llegada),
    google_maps_url: `https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`,
    direccion: address,
    ciudad: city,
    latitud: latitude,
    longitud: longitude,
    ...optional('instrucciones_llegada', row.atr_instrucciones_llegada),
  };
  const accessibility = {
    wheelchair_accessible: row.atr_accesible_silla_ruedas,
    stroller_accessible: row.atr_accesible_carriola,
    service_animals_allowed: row.atr_admite_animales_asistencia,
    accesible_silla_ruedas: row.atr_accesible_silla_ruedas,
    accesible_carriola: row.atr_accesible_carriola,
    admite_animales_asistencia: row.atr_admite_animales_asistencia,
  };
  const policy = {
    free_cancellation: row.atr_cancelacion_gratuita,
    deadline_hours: row.atr_horas_cancelacion,
    ...optional('description', row.atr_politica_cancelacion),
    cancelacion_gratuita: row.atr_cancelacion_gratuita,
    horas_limite: row.atr_horas_cancelacion,
    ...optional('descripcion', row.atr_politica_cancelacion),
  };
  return {
    id: row.atr_codigo,
    uuid: row.atr_uuid,
    slug: row.atr_slug,
    name: row.atr_nombre,
    description: row.atr_descripcion,
    city,
    duration,
    price: priceTable,
    rating: fullRating,
    inclusions: flags,
    inclusions_list: children.inclusiones.filter((item) => item.inc_tipo === 'INCLUYE').map((item) => item.inc_nombre),
    exclusions_list: children.inclusiones.filter((item) => item.inc_tipo === 'NO_INCLUYE').map((item) => item.inc_nombre),
    itinerary,
    meeting_point_geo: geo,
    accessibility,
    guide_languages: children.idiomas.map((item) => item.idi_nombre),
    cancellation_policy: policy,
    permite_paquete: row.atr_permite_paquete,
    porcentaje_descuento_paquete: Number(row.atr_porcentaje_descuento_paquete),
    photos: children.fotos.map((foto) => foto.fot_url),
    proveedor: {
      id: row.ope_codigo,
      nombre_comercial: row.ope_nombre,
      ...optional('ruc', row.ope_ruc),
      ...optional('telefono_emergencia', row.ope_telefono),
      ...optional('email_soporte', row.ope_correo),
    },
    nombre: row.atr_nombre,
    descripcion: row.atr_descripcion,
    ciudad: city,
    duracion: duration,
    precio: priceTable,
    calificacion: fullRating,
    inclusiones: flags,
    punto_encuentro_geo: geo,
    itinerario: itinerary,
    accesibilidad: accessibility,
    politica_cancelacion: policy,
  };
}

/** `AtraccionAdmin`: la ficha, más lo que hace falta para editar. */
export function toAdmin(row: AttractionRow, city: string, children: AttractionChildren) {
  return {
    ...toDetail(row, city, children),
    estado: row.atr_estado,
    tipo: row.atr_tipo,
    ciu_id: row.ciu_id,
    // Valores tal como se guardan, para que el editor del panel no los mezcle (la ficha une dirección y punto de encuentro).
    operador: row.ope_codigo,
    short_description: row.atr_descripcion_corta,
    duration_hours: Number(row.atr_duracion_horas),
    address: row.atr_direccion,
    meeting_point: row.atr_punto_encuentro,
    destacada: row.atr_destacada,
    categorias: children.categorias.map((item) => item.cat_codigo),
    idiomas: children.idiomas.map((item) => item.idi_codigo),
    inclusiones: children.inclusiones.map((item) => item.inc_id),
    fotos: children.fotos.map((foto) => ({ url: foto.fot_url, alt: foto.fot_alt, orden: foto.fot_orden })),
  };
}
