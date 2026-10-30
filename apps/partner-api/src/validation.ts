import type { InvalidParam } from '@atracciones/platform';

// Las reglas de documentos, teléfono y nombre del titular son comunes con GraphQL e Identity.
export { isValidCedula, isValidFullName, isValidPassport, isValidPhone, isValidRuc, validateCustomer, type CustomerInput } from '@atracciones/platform';

/** Pares de campo en inglés y alias en español que deben coincidir si se envían ambos (§7.4). */
export const RESERVATION_ALIASES: [string, string][] = [
  ['adult_count', 'cantidad_adultos'],
  ['child_count', 'cantidad_ninos'],
  ['senior_count', 'cantidad_seniors'],
  ['student_count', 'cantidad_estudiantes'],
  ['infant_count', 'cantidad_infantes'],
  ['payment_method', 'metodo_pago'],
  ['special_requirements', 'observaciones'],
];

export const CUSTOMER_ALIASES: [string, string][] = [
  ['full_name', 'nombre_completo'],
  ['email', 'correo'],
  ['phone', 'telefono'],
  ['document_type', 'tipo_documento'],
  ['document_id', 'numero_documento'],
];

/** Alias contradictorios dentro de un objeto enviado por el cliente. */
export function aliasConflicts(sent: Record<string, unknown> | undefined, pairs: [string, string][], prefix = ''): InvalidParam[] {
  if (!sent) return [];
  return pairs
    .filter(([en, es]) => sent[en] !== undefined && sent[es] !== undefined && sent[en] !== sent[es])
    .map(([en, es]) => ({ name: `${prefix}${es}`, reason: `Debe ser igual a ${prefix}${en}.` }));
}
