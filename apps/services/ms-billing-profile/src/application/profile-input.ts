import { AppError, isValidCedula, type InvalidParam } from '@atracciones/platform';
import { FINAL_CONSUMER_ID, ID_TYPES, type DatoFacturacionInput, type TipoIdentificacion } from '../contract';

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[0-9]{7,15}$/;

function identificationError(tipo: TipoIdentificacion, value: string): string | null {
  if (tipo === 'CEDULA') return isValidCedula(value) ? null : 'La cédula no es válida.';
  if (tipo === 'RUC') return /^[0-9]{13}$/.test(value) ? null : 'El RUC debe tener 13 dígitos.';
  if (tipo === 'PASAPORTE') return /^[A-Z0-9]{6,20}$/.test(value) ? null : 'El pasaporte debe tener de 6 a 20 letras o dígitos.';
  return value === FINAL_CONSUMER_ID ? null : `Para consumidor final debe ser ${FINAL_CONSUMER_ID}.`;
}

export function parseProfile(body: unknown): DatoFacturacionInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: InvalidParam[] = [];
  const text = (name: string) => (typeof b[name] === 'string' ? (b[name] as string).trim() : '');

  const tipo = b.tipo_identificacion as TipoIdentificacion;
  if (!ID_TYPES.includes(tipo)) errors.push({ name: 'tipo_identificacion', reason: `Debe ser ${ID_TYPES.join(', ')}.` });

  let identificacion = text('identificacion');
  if (tipo === 'PASAPORTE') identificacion = identificacion.toUpperCase();
  if (tipo === 'CONSUMIDOR_FINAL' && identificacion === '') identificacion = FINAL_CONSUMER_ID;
  if (ID_TYPES.includes(tipo)) {
    const reason = identificationError(tipo, identificacion);
    if (reason) errors.push({ name: 'identificacion', reason });
  }

  const razonSocial = text('razon_social');
  if (razonSocial === '' || razonSocial.length > 150) errors.push({ name: 'razon_social', reason: 'Es obligatoria, de hasta 150 caracteres.' });

  const correo = text('correo').toLowerCase();
  if (correo.length > 160 || !EMAIL.test(correo)) errors.push({ name: 'correo', reason: 'El correo no es válido.' });

  const telefono = text('telefono') || null;
  if (b.telefono !== undefined && b.telefono !== null && typeof b.telefono !== 'string') errors.push({ name: 'telefono', reason: 'Debe ser texto.' });
  if (telefono && !PHONE.test(telefono)) errors.push({ name: 'telefono', reason: 'El teléfono no es válido.' });

  if (b.es_principal !== undefined && typeof b.es_principal !== 'boolean') errors.push({ name: 'es_principal', reason: 'Debe ser booleano.' });

  if (errors.length > 0) throw AppError.validation('Los datos de facturación son inválidos.', errors);
  return { tipo_identificacion: tipo, identificacion, razon_social: razonSocial, correo, telefono, es_principal: b.es_principal === true };
}

export function parseId(value: unknown, name = 'id'): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validation(`'${name}' debe ser un entero positivo.`, [{ name, reason: 'Debe ser un entero positivo.' }]);
  return id;
}
