import { AppError, type InvalidParam } from '@atracciones/platform';
import type { PromocionesContratoResponse } from '../contract';
import { isDate } from './dates';
import { hasAtMostTwoDecimals } from './numbers';

/** Acuerdo B2B tal como se guarda (los destinos como ids de ciudad). */
export interface Agreement {
  providerCode: string;
  commercialName: string | null;
  allowsPromotions: boolean;
  maxDiscount: number;
  agreementDate: string;
  validUntil: string;
  comboConditions: string | null;
  contact: { name: string | null; email: string | null; phone: string | null };
  destinationIds: number[];
}

/** Respuestas del cuestionario (`ActualizarPromocionesContratoRequest`). `undefined` = conservar el valor anterior. */
export interface AgreementUpdate {
  allowsPromotions: boolean;
  maxDiscount: number;
  destinations?: string[];
  validUntil?: string;
  comboConditions?: string | null;
  contact?: { name?: string; email?: string; phone?: string };
}

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[0-9]{7,15}$/;

/**
 * Valida el cuerpo del `PUT /atracciones/promociones/contrato`. Todo error es `400`: el contrato v3 no lista `422`
 * para esta ruta.
 */
export function parseAgreementUpdate(value: unknown): AgreementUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw AppError.validation('El cuerpo debe ser un objeto JSON.');
  const body = value as Record<string, unknown>;
  const invalid: InvalidParam[] = [];

  if (typeof body.permite_promociones !== 'boolean') invalid.push({ name: 'permite_promociones', reason: 'Es obligatorio y debe ser true o false.' });
  const pct = body.porcentaje_descuento_maximo;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 50) {
    invalid.push({ name: 'porcentaje_descuento_maximo', reason: 'Es obligatorio y debe estar entre 0 y 50.' });
  } else if (!hasAtMostTwoDecimals(pct)) {
    invalid.push({ name: 'porcentaje_descuento_maximo', reason: 'Máximo dos decimales.' });
  }

  let destinations: string[] | undefined;
  if (body.destinos_habilitados !== undefined) {
    const list = body.destinos_habilitados;
    if (!Array.isArray(list) || list.some((d) => typeof d !== 'string' || !d.trim() || d.length > 120)) {
      invalid.push({ name: 'destinos_habilitados', reason: 'Lista de nombres de ciudad (texto de 1 a 120 caracteres).' });
    } else {
      destinations = [...new Set(list.map((d: string) => d.trim()))];
    }
  }

  if (body.vigencia_hasta !== undefined && !isDate(body.vigencia_hasta)) invalid.push({ name: 'vigencia_hasta', reason: 'Fecha YYYY-MM-DD.' });

  let comboConditions: string | null | undefined;
  if (body.condiciones_combo !== undefined) {
    if (body.condiciones_combo !== null && (typeof body.condiciones_combo !== 'string' || body.condiciones_combo.length > 500)) {
      invalid.push({ name: 'condiciones_combo', reason: 'Texto de hasta 500 caracteres.' });
    } else {
      comboConditions = typeof body.condiciones_combo === 'string' && body.condiciones_combo.trim() ? body.condiciones_combo.trim() : null;
    }
  }

  let contact: AgreementUpdate['contact'];
  if (body.contacto_comercial !== undefined) {
    const c = body.contacto_comercial as Record<string, unknown> | null;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      invalid.push({ name: 'contacto_comercial', reason: 'Objeto con nombre, email y telefono.' });
    } else {
      contact = {};
      if (c.nombre !== undefined) {
        if (typeof c.nombre !== 'string' || !c.nombre.trim() || c.nombre.length > 120) invalid.push({ name: 'contacto_comercial.nombre', reason: 'Texto de 1 a 120 caracteres.' });
        else contact.name = c.nombre.trim();
      }
      if (c.email !== undefined) {
        if (typeof c.email !== 'string' || c.email.length > 160 || !EMAIL.test(c.email)) invalid.push({ name: 'contacto_comercial.email', reason: 'Correo electrónico válido.' });
        else contact.email = c.email;
      }
      if (c.telefono !== undefined) {
        if (typeof c.telefono !== 'string' || !PHONE.test(c.telefono)) invalid.push({ name: 'contacto_comercial.telefono', reason: 'Formato internacional, 7 a 15 dígitos (+593…).' });
        else contact.phone = c.telefono;
      }
    }
  }

  if (invalid.length) throw AppError.validation('El acuerdo de promociones no es válido.', invalid);
  return {
    allowsPromotions: body.permite_promociones as boolean,
    maxDiscount: pct as number,
    ...(destinations !== undefined ? { destinations } : {}),
    ...(body.vigencia_hasta !== undefined ? { validUntil: body.vigencia_hasta as string } : {}),
    ...(comboConditions !== undefined ? { comboConditions } : {}),
    ...(contact !== undefined ? { contact } : {}),
  };
}

/**
 * Nuevo estado del acuerdo: las preguntas obligatorias se reemplazan, los campos opcionales que no se envían conservan
 * su valor y `fecha_acuerdo` pasa a hoy (el acuerdo se formaliza de nuevo). `destinationIds` solo cambia si se enviaron
 * destinos (ya resueltos a ids).
 */
export function mergeAgreement(current: Agreement, update: AgreementUpdate, today: string, destinationIds?: number[]): Agreement {
  const merged: Agreement = {
    ...current,
    allowsPromotions: update.allowsPromotions,
    maxDiscount: update.maxDiscount,
    agreementDate: today,
    validUntil: update.validUntil ?? current.validUntil,
    comboConditions: update.comboConditions !== undefined ? update.comboConditions : current.comboConditions,
    contact: {
      name: update.contact?.name ?? current.contact.name,
      email: update.contact?.email ?? current.contact.email,
      phone: update.contact?.phone ?? current.contact.phone,
    },
    destinationIds: destinationIds ?? current.destinationIds,
  };
  if (merged.validUntil < today) {
    throw AppError.validation('La vigencia del acuerdo no puede terminar antes de hoy.', [
      { name: 'vigencia_hasta', reason: `Debe ser igual o posterior a ${today}${update.validUntil ? '' : ' (la vigencia guardada ya venció: envíe una nueva)'}.` },
    ]);
  }
  return merged;
}

/** `PromocionesContratoResponse`: los campos opcionales vacíos se omiten. */
export function toAgreementResponse(agreement: Agreement, destinationNames: string[]): PromocionesContratoResponse {
  return {
    proveedor_id: agreement.providerCode,
    ...(agreement.commercialName ? { nombre_comercial: agreement.commercialName } : {}),
    permite_promociones: agreement.allowsPromotions,
    porcentaje_descuento_maximo: agreement.maxDiscount,
    destinos_habilitados: destinationNames,
    fecha_acuerdo: agreement.agreementDate,
    vigencia_hasta: agreement.validUntil,
    ...(agreement.comboConditions ? { condiciones_combo: agreement.comboConditions } : {}),
  };
}
