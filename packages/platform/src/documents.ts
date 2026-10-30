import type { InvalidParam } from './problem-details';

/**
 * Cédula ecuatoriana: 10 dígitos, provincia 01–24 (o 30, ecuatorianos en el exterior), tercer dígito menor que 6
 * (persona natural) y dígito verificador con el algoritmo de módulo 10 (coeficientes 2-1-2-1…).
 */
export function isValidCedula(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const province = Number(value.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30) || Number(value[2]) >= 6) return false;
  const sum = [...value.slice(0, 9)].reduce((acc, digit, i) => {
    const product = Number(digit) * (i % 2 === 0 ? 2 : 1);
    return acc + (product > 9 ? product - 9 : product);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

/** RUC: 13 dígitos terminados en establecimiento (001 en adelante); el de persona natural parte de una cédula válida. */
export function isValidRuc(value: string): boolean {
  if (!/^\d{13}$/.test(value) || value.endsWith('000')) return false;
  const third = Number(value[2]);
  return third < 6 ? isValidCedula(value.slice(0, 10)) : third === 6 || third === 9;
}

export const isValidPassport = (value: string) => /^[A-Za-z0-9]{6,9}$/.test(value);

/** E.164 (`+593991234567`) o celular ecuatoriano (`0991234567`). */
export const isValidPhone = (value: string) => /^\+[1-9]\d{7,14}$/.test(value) || /^09\d{8}$/.test(value);

/** Al menos dos palabras con letras (admite tildes, ñ, apóstrofos y guiones). */
export const isValidFullName = (value: string) => /^\p{L}[\p{L}'.-]*(\s+\p{L}[\p{L}'.-]*)+$/u.test(value.trim());

export const isValidEmail = (value: string) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;

/** Documento según su tipo (`CEDULA`, `RUC` o `PASAPORTE`). */
export function isValidDocument(type: string, id: string): boolean {
  return type === 'CEDULA' ? isValidCedula(id) : type === 'RUC' ? isValidRuc(id) : type === 'PASAPORTE' && isValidPassport(id);
}

export const documentReason = (type: string) =>
  type === 'CEDULA' ? 'La cédula debe tener 10 dígitos y un dígito verificador válido (módulo 10).'
  : type === 'RUC' ? 'El RUC debe tener 13 dígitos válidos.'
  : 'El pasaporte debe tener de 6 a 9 caracteres alfanuméricos.';

export interface CustomerInput {
  full_name: string;
  email: string;
  phone: string;
  document_type: string;
  document_id: string;
}

/**
 * Valida al titular de una reserva con las reglas del contrato (`CustomerContactDto`); devuelve el código del primer
 * error y todos los parámetros inválidos. En la Partner API el formato del correo ya lo valida el esquema del contrato
 * (`checkEmail: false`); GraphQL no tiene ese esquema y lo pide aquí.
 */
export function validateCustomer(
  c: CustomerInput,
  { prefix = 'customer.', checkEmail = false }: { prefix?: string; checkEmail?: boolean } = {},
): { code: string; invalid: InvalidParam[] } | null {
  const errors: { code: string; param: InvalidParam }[] = [];
  if (!isValidDocument(c.document_type, c.document_id)) {
    errors.push({ code: 'INVALID_DOCUMENT', param: { name: `${prefix}document_id`, reason: documentReason(c.document_type) } });
  }
  if (!isValidPhone(c.phone)) {
    errors.push({ code: 'INVALID_PHONE', param: { name: `${prefix}phone`, reason: 'El formato debe ser internacional E.164 o número celular válido de Ecuador (09XXXXXXXX).' } });
  }
  if (!isValidFullName(c.full_name)) {
    errors.push({ code: 'INVALID_NAME', param: { name: `${prefix}full_name`, reason: 'Debe contener al menos dos palabras con caracteres alfabéticos.' } });
  }
  if (checkEmail && !isValidEmail(c.email)) {
    errors.push({ code: 'INVALID_EMAIL', param: { name: `${prefix}email`, reason: 'Debe ser un correo electrónico válido.' } });
  }
  return errors.length ? { code: errors[0].code, invalid: errors.map((e) => e.param) } : null;
}
