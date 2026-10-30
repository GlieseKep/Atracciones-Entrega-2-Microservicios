import { AppError, isValidCedula, isValidPhone, isValidRuc, type InvalidParam } from '@atracciones/platform';
import { CONSUMIDOR_FINAL_ID, TIPOS_IDENTIFICACION, type TipoIdentificacion } from '../contract';

/** Perfil validado y normalizado, listo para guardar. */
export interface ProfileInput {
  tipo: TipoIdentificacion;
  identificacion: string;
  razonSocial: string;
  correo: string;
  telefono: string | null;
  direccion: string | null;
  esPrincipal: boolean;
}

/** Tipos que acepta la ruta de compatibilidad (los mismos que Identity). */
const LEGACY_TYPES = ['CEDULA', 'PASAPORTE', 'RUC'] as const;
/** Mismo patrón que el dominio `dom_correo`: lo que pasa aquí no lo rechaza la base. */
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PASSPORT = /^[A-Z0-9]{6,20}$/;
const MAX_ID = Number.MAX_SAFE_INTEGER;

const asObject = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw AppError.validation('El cuerpo debe ser un objeto JSON.');
  return body as Record<string, unknown>;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** ID de perfil de la ruta; `null` si no es un número válido (la ruta responde 404, no 400). */
export function parseProfileId(raw: string): number | null {
  const id = Number(raw);
  return /^[0-9]+$/.test(raw) && Number.isSafeInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}

function documentIsValid(type: TipoIdentificacion, id: string): boolean {
  switch (type) {
    case 'CEDULA': return isValidCedula(id);
    case 'RUC': return isValidRuc(id);
    case 'PASAPORTE': return PASSPORT.test(id);
    case 'CONSUMIDOR_FINAL': return id === CONSUMIDOR_FINAL_ID;
  }
}

const DOCUMENT_REASON: Record<TipoIdentificacion, string> = {
  CEDULA: 'Cédula ecuatoriana válida de 10 dígitos.',
  RUC: 'RUC válido de 13 dígitos.',
  PASAPORTE: 'Pasaporte de 6 a 20 letras o dígitos.',
  CONSUMIDOR_FINAL: `Para CONSUMIDOR_FINAL la identificación es ${CONSUMIDOR_FINAL_ID}.`,
};

/** Reglas comunes a las dos formas de entrada; los nombres de campo son los de la forma que se está validando. */
function validate(
  fields: { tipo: string; identificacion: string; razonSocial: string; correo: string; telefono: unknown; direccion: unknown },
  names: { tipo: string; identificacion: string; correo: string },
  allowedTypes: readonly string[],
  invalid: InvalidParam[],
): Omit<ProfileInput, 'esPrincipal'> {
  const tipo = fields.tipo.toUpperCase() as TipoIdentificacion;
  // CONSUMIDOR_FINAL siempre usa el número fijo; si no se envía, se completa.
  const identificacion = tipo === 'CONSUMIDOR_FINAL' && !fields.identificacion ? CONSUMIDOR_FINAL_ID : fields.identificacion.toUpperCase();
  if (!allowedTypes.includes(tipo)) invalid.push({ name: names.tipo, reason: `Debe ser uno de ${allowedTypes.join(', ')}.` });
  else if (!documentIsValid(tipo, identificacion)) invalid.push({ name: names.identificacion, reason: DOCUMENT_REASON[tipo] });
  if (fields.razonSocial.length < 2 || fields.razonSocial.length > 150) invalid.push({ name: 'razon_social', reason: 'Debe tener entre 2 y 150 caracteres.' });
  const correo = fields.correo.toLowerCase();
  if (correo.length > 160 || !EMAIL.test(correo)) invalid.push({ name: names.correo, reason: 'Debe ser un correo electrónico válido.' });
  const telefono = text(fields.telefono) || null;
  if (fields.telefono !== undefined && fields.telefono !== null && typeof fields.telefono !== 'string') invalid.push({ name: 'telefono', reason: 'Texto o null.' });
  else if (telefono && !isValidPhone(telefono)) invalid.push({ name: 'telefono', reason: 'Formato E.164 o celular de Ecuador (09XXXXXXXX).' });
  const direccion = text(fields.direccion) || null;
  if (fields.direccion !== undefined && fields.direccion !== null && typeof fields.direccion !== 'string') invalid.push({ name: 'direccion', reason: 'Texto o null.' });
  else if (direccion && direccion.length > 300) invalid.push({ name: 'direccion', reason: 'Máximo 300 caracteres.' });
  return { tipo, identificacion, razonSocial: fields.razonSocial, correo, telefono, direccion };
}

/** `BillingProfileRequest` (`POST` y `PUT` de `/usuarios/me/datos-facturacion`). */
export function parseProfile(value: unknown): ProfileInput {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  const profile = validate(
    {
      tipo: text(body.tipo_identificacion), identificacion: text(body.identificacion), razonSocial: text(body.razon_social),
      correo: text(body.correo), telefono: body.telefono, direccion: body.direccion,
    },
    { tipo: 'tipo_identificacion', identificacion: 'identificacion', correo: 'correo' },
    TIPOS_IDENTIFICACION,
    invalid,
  );
  if (body.es_principal !== undefined && typeof body.es_principal !== 'boolean') invalid.push({ name: 'es_principal', reason: 'true o false.' });
  if (invalid.length) throw AppError.validation('Los datos de facturación no son válidos.', invalid);
  return { ...profile, esPrincipal: body.es_principal === true };
}

/** `LegacyBillingRequest` (`PUT /usuarios/me/facturacion`, forma de Identity). Siempre es el principal. */
export function parseLegacy(value: unknown): ProfileInput {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  const profile = validate(
    {
      tipo: text(body.tipo_documento), identificacion: text(body.numero_documento), razonSocial: text(body.razon_social),
      correo: text(body.email), telefono: body.telefono, direccion: body.direccion,
    },
    { tipo: 'tipo_documento', identificacion: 'numero_documento', correo: 'email' },
    LEGACY_TYPES,
    invalid,
  );
  if (invalid.length) throw AppError.validation('Los datos de facturación no son válidos.', invalid);
  return { ...profile, esPrincipal: true };
}
