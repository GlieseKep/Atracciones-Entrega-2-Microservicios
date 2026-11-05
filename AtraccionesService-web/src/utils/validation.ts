import { z } from 'zod';

/** Esquemas zod con las mismas reglas que validan ms-identity, ms-booking, ms-billing-profile, ms-review y ms-support. */

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** Identity y Billing: teléfono de 7 a 15 dígitos, con `+` opcional. */
const PHONE = /^\+?[0-9]{7,15}$/;
/** Booking: E.164 o celular de Ecuador (09XXXXXXXX). */
const BOOKING_PHONE = /^(\+[1-9]\d{7,14}|09\d{8})$/;

/** Cédula ecuatoriana: provincia 01–24 (o 30), tercer dígito < 6 y dígito verificador módulo 10. */
export function isValidCedula(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const province = Number(value.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30) || Number(value[2]) >= 6) return false;
  const sum = [...value.slice(0, 9)].reduce((acc, digit, i) => {
    const n = Number(digit) * (i % 2 === 0 ? 2 : 1);
    return acc + (n > 9 ? n - 9 : n);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

/** RUC: 13 dígitos sin terminar en 000; persona natural (cédula), pública (6) o privada (9). */
export function isValidRuc(value: string): boolean {
  if (!/^\d{13}$/.test(value) || value.endsWith('000')) return false;
  const third = Number(value[2]);
  return third < 6 ? isValidCedula(value.slice(0, 10)) : third === 6 || third === 9;
}

const email = z.string().trim().max(160, 'Máximo 160 caracteres.').regex(EMAIL, 'Introduce un correo válido.');
const optionalText = (schema: z.ZodString) => schema.optional().or(z.literal(''));

export const passwordSchema = z
  .string()
  .min(8, 'Mínimo 8 caracteres.')
  .max(72, 'Máximo 72 caracteres.');

export const loginSchema = z.object({
  correo: email,
  password: z.string().min(1, 'Indica tu contraseña.'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    nombre: z.string().trim().min(1, 'Indica tu nombre.').max(120, 'Máximo 120 caracteres.'),
    apellido: z.string().trim().min(1, 'Indica tu apellido.').max(120, 'Máximo 120 caracteres.'),
    correo: email,
    telefono: optionalText(z.string().trim().regex(PHONE, 'De 7 a 15 dígitos, con + opcional.')),
    password: passwordSchema,
    confirm: z.string(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los términos de uso.' }) }),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' });
export type RegisterValues = z.infer<typeof registerSchema>;

export const recoverySchema = z.object({ correo: email });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' });

export const changePasswordSchema = z
  .object({ actual: z.string().min(1, 'Indica tu contraseña actual.'), nuevo: passwordSchema, confirm: z.string() })
  .refine((v) => v.nuevo === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const profileSchema = z.object({
  nombre: z.string().trim().min(1, 'Indica tu nombre.').max(120),
  apellido: z.string().trim().min(1, 'Indica tu apellido.').max(120),
  documento: optionalText(z.string().trim().toUpperCase().regex(/^([0-9]{10}|[A-Z]{1,2}[0-9]{6,9})$/, 'Cédula de 10 dígitos o pasaporte.')),
  telefono: optionalText(z.string().trim().regex(PHONE, 'De 7 a 15 dígitos, con + opcional.')),
  fecha_nacimiento: optionalText(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida.')),
});
export type ProfileValues = z.infer<typeof profileSchema>;

/** Titular de la compra (`CustomerContactDto`). */
export const customerSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .max(150)
      .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, 'Escribe nombre y apellido.'),
    email,
    phone: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s-]/g, ''))
      .refine((v) => BOOKING_PHONE.test(v), 'Formato internacional (+593…) o celular 09XXXXXXXX.'),
    document_type: z.enum(['CEDULA', 'PASAPORTE', 'RUC']),
    document_id: z.string().trim().toUpperCase(),
  })
  .superRefine((v, ctx) => {
    const ok =
      v.document_type === 'CEDULA'
        ? isValidCedula(v.document_id)
        : v.document_type === 'RUC'
          ? isValidRuc(v.document_id)
          : /^[A-Z0-9]{6,9}$/.test(v.document_id);
    if (!ok) {
      const message = { CEDULA: 'Cédula no válida.', RUC: 'RUC no válido (13 dígitos).', PASAPORTE: 'Pasaporte de 6 a 9 letras o dígitos.' }[v.document_type];
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['document_id'], message });
    }
  });
export type CustomerValues = z.infer<typeof customerSchema>;

/** Datos no sensibles de la tarjeta: nunca se pide el número completo ni el código de seguridad. */
export const cardSchema = z.object({
  marca: z.enum(['VISA', 'MASTERCARD', 'AMEX', 'DINERS']),
  titular: z.string().trim().min(3, 'Indica el titular.').max(120),
  ultimos4: z.string().trim().regex(/^\d{4}$/, 'Los 4 últimos dígitos.'),
  mes: z.coerce.number().int().min(1, 'Mes no válido.').max(12, 'Mes no válido.'),
  anio: z.coerce
    .number()
    .int()
    .min(new Date().getFullYear(), 'La tarjeta está vencida.')
    .max(new Date().getFullYear() + 20, 'Año no válido.'),
});
export type CardValues = z.infer<typeof cardSchema>;

export const billingProfileSchema = z
  .object({
    tipo_identificacion: z.enum(['CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL']),
    identificacion: z.string().trim().toUpperCase(),
    razon_social: z.string().trim().min(1, 'Indica el nombre o la razón social.').max(150),
    correo: email,
    telefono: optionalText(z.string().trim().regex(PHONE, 'De 7 a 15 dígitos, con + opcional.')),
    es_principal: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const reason =
      v.tipo_identificacion === 'CEDULA'
        ? !isValidCedula(v.identificacion) && 'La cédula no es válida.'
        : v.tipo_identificacion === 'RUC'
          ? !/^[0-9]{13}$/.test(v.identificacion) && 'El RUC debe tener 13 dígitos.'
          : v.tipo_identificacion === 'PASAPORTE'
            ? !/^[A-Z0-9]{6,20}$/.test(v.identificacion) && 'De 6 a 20 letras o dígitos.'
            : false;
    if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identificacion'], message: reason });
  });
export type BillingProfileValues = z.infer<typeof billingProfileSchema>;

export const contactSchema = z.object({
  nombre: z.string().trim().min(1, 'Indica tu nombre.').max(120),
  correo: email,
  asunto: z.string().trim().min(1, 'Indica el asunto.').max(30, 'Máximo 30 caracteres.'),
  cuerpo: z.string().trim().min(1, 'Escribe tu mensaje.').max(2000, 'Máximo 2000 caracteres.'),
});
export type ContactValues = z.infer<typeof contactSchema>;

const score = z.coerce.number().int().min(1, 'De 1 a 10.').max(10, 'De 1 a 10.');

export const reviewSchema = z.object({
  puntuacion: score,
  limpieza: score,
  servicio: score,
  calidad_precio: score,
  puntualidad: score,
  comentario: z.string().trim().min(1, 'Cuéntanos tu experiencia.').max(1000, 'Máximo 1000 caracteres.'),
});
export type ReviewValues = z.infer<typeof reviewSchema>;

export const cancelReasonSchema = z.object({
  reason: z.string().trim().min(1, 'Indica el motivo.').max(500, 'Máximo 500 caracteres.'),
});
export type CancelReasonValues = z.infer<typeof cancelReasonSchema>;
