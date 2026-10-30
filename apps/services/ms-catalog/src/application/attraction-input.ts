import { normalizeTime } from '@atracciones/platform';
import { ATTRACTION_TYPES, type AttractionInput, type ItineraryStopInput } from '../contract';
import { Fields } from './fields';

/** Chocarían con rutas del contrato (`/atracciones/{slug}`). */
const RESERVED_SLUGS = new Set(['search', 'categorias', 'reservas', 'promociones', 'eventos', 'health']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const isReservedSlug = (slug: string) => RESERVED_SLUGS.has(slug);

export const slugify = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200).replace(/-+$/, '');

function parseStop(value: unknown, index: number, f: Fields): ItineraryStopInput {
  const stop = new Fields(value, `itinerario[${index}].`);
  const time = String(stop.body.time ?? stop.body.hora ?? '');
  const hora = normalizeTime(time);
  if (!hora) stop.fail('time', 'La hora no es válida.');
  const body = stop.body;
  body.stop_number ??= body.numero_parada;
  body.title ??= body.titulo;
  body.description ??= body.descripcion;
  body.duration_minutes ??= body.duracion_minutos;
  body.location_name ??= body.nombre_ubicacion;
  const result: ItineraryStopInput = {
    numero: stop.integer('stop_number', { min: 1, max: 32767 }),
    hora: hora ?? '00:00:00',
    titulo: stop.text('title', 200),
    descripcion: stop.optionalText('description', 500),
    duracionMinutos: stop.integer('duration_minutes', { min: 1, max: 32767 }),
    ubicacion: stop.optionalText('location_name', 200),
  };
  f.errors.push(...stop.errors);
  return result;
}

export function parseAttraction(body: unknown): AttractionInput {
  const f = new Fields(body);
  const flags = new Fields(f.body.inclusions, 'inclusions.');
  const access = new Fields(f.body.accessibility, 'accessibility.');
  const policy = new Fields(f.body.cancellation_policy, 'cancellation_policy.');

  const fotos = Array.isArray(f.body.fotos) ? f.body.fotos : [];
  const itinerario = Array.isArray(f.body.itinerario) ? f.body.itinerario : [];
  if (f.has('fotos') && !Array.isArray(f.body.fotos)) f.fail('fotos', 'Debe ser una lista.');
  if (f.has('itinerario') && !Array.isArray(f.body.itinerario)) f.fail('itinerario', 'Debe ser una lista.');

  const inclusiones = f.has('inclusiones') ? f.body.inclusiones : [];
  if (!Array.isArray(inclusiones) || inclusiones.some((id) => !Number.isInteger(id))) f.fail('inclusiones', 'Debe ser una lista de enteros.');

  const permitePaquete = f.bool('permite_paquete');
  const porcentaje = f.has('porcentaje_descuento_paquete') ? f.number('porcentaje_descuento_paquete', { min: 0, max: 100 }) : 0;
  if (!permitePaquete && porcentaje > 0) f.fail('porcentaje_descuento_paquete', 'Requiere permite_paquete.');

  const input: AttractionInput = {
    nombre: f.text('name', 200),
    slug: f.optionalText('slug', 220, SLUG),
    descripcion: f.text('description', 100_000),
    descripcionCorta: f.optionalText('short_description', 280),
    tipo: f.oneOf('tipo', ATTRACTION_TYPES),
    latitud: f.number('latitude', { min: -90, max: 90 }),
    longitud: f.number('longitude', { min: -180, max: 180 }),
    direccion: f.optionalText('address', 255),
    puntoEncuentro: f.optionalText('meeting_point', 255),
    instruccionesLlegada: f.optionalText('arrival_instructions', 500),
    duracionHoras: f.number('duration_hours', { min: 0.01, max: 720 }),
    ciuId: f.integer('ciu_id', { min: 1, max: 32767 }),
    operador: f.text('operador', 60),
    categorias: f.stringList('categorias', true),
    idiomas: f.stringList('idiomas'),
    inclusiones: Array.isArray(inclusiones) ? [...new Set(inclusiones as number[])] : [],
    fotos: fotos.map((value: unknown, index: number) => {
      const foto = new Fields(value, `fotos[${index}].`);
      const result = { url: foto.text('url', 500), alt: foto.text('alt', 200), orden: foto.integer('orden', { min: 0, max: 32767 }, index) };
      f.errors.push(...foto.errors);
      return result;
    }),
    itinerario: itinerario.map((value: unknown, index: number) => parseStop(value, index, f)),
    incluyeComida: flags.bool('includes_food', flags.bool('incluye_comida')),
    incluyeTransporte: flags.bool('includes_transport', flags.bool('incluye_transporte')),
    incluyeGuia: flags.bool('includes_guide', flags.bool('incluye_guia')),
    accesibleSillaRuedas: access.bool('wheelchair_accessible', access.bool('accesible_silla_ruedas')),
    accesibleCarriola: access.bool('stroller_accessible', access.bool('accesible_carriola')),
    admiteAnimalesAsistencia: access.bool('service_animals_allowed', access.bool('admite_animales_asistencia')),
    cancelacionGratuita: policy.bool('free_cancellation', policy.bool('cancelacion_gratuita')),
    horasCancelacion: policy.integer('deadline_hours', { min: 0, max: 32767 }, policy.integer('horas_limite', { min: 0, max: 32767 }, 24)),
    politicaCancelacion: policy.optionalText('description', 500) ?? policy.optionalText('descripcion', 500),
    permitePaquete,
    porcentajeDescuentoPaquete: porcentaje,
    destacada: f.bool('destacada'),
  };
  f.errors.push(...flags.errors, ...access.errors, ...policy.errors);
  if (input.slug && isReservedSlug(input.slug)) f.fail('slug', 'Es una palabra reservada.');
  if (new Set(input.itinerario.map((stop) => stop.numero)).size !== input.itinerario.length) f.fail('itinerario', 'stop_number no se puede repetir.');
  f.done();
  return input;
}
