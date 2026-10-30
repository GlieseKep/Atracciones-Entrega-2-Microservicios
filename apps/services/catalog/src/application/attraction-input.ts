import { AppError, normalizeTime, type InvalidParam } from '@atracciones/platform';
import type { AttractionInput } from '../persistence/catalog-admin-repository';

type Body = Record<string, unknown>;

/** Lee y valida los datos de una atracción enviados por la administración (mismos límites que las columnas). */
export function parseAttractionInput(body: Body, defaultOperator: string): AttractionInput {
  const invalid: InvalidParam[] = [];
  const text = (name: string, value: unknown, min: number, max: number): string => {
    const v = typeof value === 'string' ? value.trim() : '';
    if (v.length < min || v.length > max) invalid.push({ name, reason: min > 0 ? `Debe tener entre ${min} y ${max} caracteres.` : `Máximo ${max} caracteres.` });
    return v;
  };
  const optional = (name: string, value: unknown, max: number): string | null => {
    const v = typeof value === 'string' ? value.trim() : '';
    if (v.length > max) invalid.push({ name, reason: `Máximo ${max} caracteres.` });
    return v || null;
  };
  const number = (name: string, value: unknown, min: number, max: number): number => {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(n) || n < min || n > max) invalid.push({ name, reason: `Debe ser un número entre ${min} y ${max}.` });
    return n;
  };
  const bool = (value: unknown) => value === true;
  const list = (name: string, value: unknown, maxItems: number, maxLength: number): string[] => {
    const items = Array.isArray(value) ? value.map((v) => String(v ?? '').trim()).filter(Boolean) : [];
    if (items.length > maxItems) invalid.push({ name, reason: `Máximo ${maxItems} elementos.` });
    if (items.some((i) => i.length > maxLength)) invalid.push({ name, reason: `Cada elemento admite como máximo ${maxLength} caracteres.` });
    return [...new Set(items)];
  };

  const pe = (body.punto_encuentro ?? {}) as Body;
  const cancelacion = (body.cancelacion ?? {}) as Body;
  const fotos = list('fotos', body.fotos, 12, 1000);
  if (fotos.some((url) => !/^https:\/\/\S+$/.test(url))) invalid.push({ name: 'fotos', reason: 'Cada foto debe ser una URL https.' });
  const itinerario = (Array.isArray(body.itinerario) ? body.itinerario : []).map((raw, i) => {
    const p = (raw ?? {}) as Body;
    const hora = normalizeTime(String(p.hora ?? ''));
    if (!hora) invalid.push({ name: `itinerario[${i}].hora`, reason: 'Formato HH:mm.' });
    return {
      hora: hora ?? '00:00:00',
      titulo: text(`itinerario[${i}].titulo`, p.titulo, 2, 200),
      descripcion: optional(`itinerario[${i}].descripcion`, p.descripcion, 1000),
      duracion_minutos: number(`itinerario[${i}].duracion_minutos`, p.duracion_minutos, 1, 1440),
      nombre_ubicacion: optional(`itinerario[${i}].nombre_ubicacion`, p.nombre_ubicacion, 200),
    };
  });
  if (itinerario.length > 30) invalid.push({ name: 'itinerario', reason: 'Máximo 30 paradas.' });

  const input: AttractionInput = {
    nombre: text('nombre', body.nombre, 3, 200),
    descripcion_corta: text('descripcion_corta', body.descripcion_corta, 10, 300),
    descripcion: text('descripcion', body.descripcion, 20, 10_000),
    categoria_codigo: text('categoria_codigo', body.categoria_codigo, 1, 40),
    ciudad_id: number('ciudad_id', body.ciudad_id, 1, 2_147_483_647),
    operador_codigo: (typeof body.operador_codigo === 'string' && body.operador_codigo.trim()) || defaultOperator,
    duracion_horas: number('duracion_horas', body.duracion_horas, 0.5, 240),
    incluye_comida: bool(body.incluye_comida),
    incluye_transporte: bool(body.incluye_transporte),
    incluye_guia: bool(body.incluye_guia),
    punto_encuentro: {
      direccion: text('punto_encuentro.direccion', pe.direccion, 5, 300),
      latitud: number('punto_encuentro.latitud', pe.latitud, -90, 90),
      longitud: number('punto_encuentro.longitud', pe.longitud, -180, 180),
      instrucciones: optional('punto_encuentro.instrucciones', pe.instrucciones, 500),
      google_maps_url: optional('punto_encuentro.google_maps_url', pe.google_maps_url, 500),
    },
    accesible_silla_ruedas: bool(body.accesible_silla_ruedas),
    accesible_carriola: bool(body.accesible_carriola),
    admite_animales_asistencia: bool(body.admite_animales_asistencia),
    cancelacion: {
      gratuita: bool(cancelacion.gratuita),
      horas_limite: number('cancelacion.horas_limite', cancelacion.horas_limite ?? 24, 0, 720),
      descripcion: optional('cancelacion.descripcion', cancelacion.descripcion, 500),
    },
    permite_paquete: bool(body.permite_paquete),
    idiomas: list('idiomas', body.idiomas, 10, 2).map((i) => i.toLowerCase()),
    inclusiones: list('inclusiones', body.inclusiones, 20, 300),
    exclusiones: list('exclusiones', body.exclusiones, 20, 300),
    fotos,
    itinerario,
  };
  if (!Number.isInteger(input.ciudad_id)) invalid.push({ name: 'ciudad_id', reason: 'Debe ser un entero.' });
  if (!Number.isInteger(input.cancelacion.horas_limite)) invalid.push({ name: 'cancelacion.horas_limite', reason: 'Debe ser un entero.' });
  if (input.fotos.length === 0) invalid.push({ name: 'fotos', reason: 'Se requiere al menos una foto.' });
  if (invalid.length) throw AppError.validation('Los datos de la atracción no son válidos.', invalid);
  return input;
}
