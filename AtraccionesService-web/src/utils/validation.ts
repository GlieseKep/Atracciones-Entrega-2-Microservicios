import { z } from 'zod';
import { isNotPast, isValidLocalTime } from './dates';

/** Esquemas zod alineados con las validaciones de AtraccionesService.Contracts. */

export const isoDateSchema = z
  .string({ required_error: 'Selecciona una fecha.' })
  .min(1, 'Selecciona una fecha.')
  .refine(isNotPast, 'La fecha debe ser hoy o posterior.');

export const localTimeSchema = z
  .string({ required_error: 'Selecciona un horario.' })
  .min(1, 'Selecciona un horario.')
  .refine(isValidLocalTime, 'El horario debe tener formato HH:mm.');

export const ticketCountSchema = z.coerce
  .number({ invalid_type_error: 'Indica un número.' })
  .int('Debe ser un número entero.')
  .min(1, 'Mínimo 1 entrada.')
  .max(100, 'Máximo 100 entradas.');

export const reservationFormSchema = z.object({
  date: isoDateSchema,
  time: localTimeSchema,
  ticketCount: ticketCountSchema,
  customerName: z.string().trim().min(1, 'Indica el nombre del titular.').max(200, 'Máximo 200 caracteres.'),
  customerEmail: z.string().trim().email('Introduce un correo válido.').max(254, 'Máximo 254 caracteres.'),
  acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar la política de cancelación.' }) }),
});
export type ReservationFormValues = z.infer<typeof reservationFormSchema>;

/** Referencia de pago simulado: alfanumérica y nunca solo dígitos (para que no sea un número de tarjeta). */
export const paymentReferenceSchema = z
  .string()
  .trim()
  .regex(/^(?!\d+$)[A-Za-z0-9_-]{1,64}$/, 'Usa una referencia alfanumérica (no un número de tarjeta).');

export const billingFormSchema = z.object({
  billingName: z.string().trim().min(1, 'Indica el nombre de facturación.').max(200),
  billingEmail: z.string().trim().email('Introduce un correo válido.').max(254),
  billingAddress: z.string().trim().min(1, 'Indica la dirección de facturación.').max(300),
  taxId: z.string().trim().max(30, 'Máximo 30 caracteres.').optional().or(z.literal('')),
  paymentMethodReference: paymentReferenceSchema.optional().or(z.literal('')),
});
export type BillingFormValues = z.infer<typeof billingFormSchema>;

export const cancelReasonSchema = z.object({
  reason: z.string().trim().min(1, 'Indica el motivo.').max(500, 'Máximo 500 caracteres.'),
});
export type CancelReasonValues = z.infer<typeof cancelReasonSchema>;

export const isoDurationRegex = /^P(?!$)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?)?$/;

export const attractionFormSchema = z.object({
  name: z.string().trim().min(3, 'Mínimo 3 caracteres.').max(200),
  longDescription: z.string().trim().min(1, 'Describe la atracción.').max(5000),
  duration: z.string().trim().regex(isoDurationRegex, 'Usa una duración ISO 8601, por ejemplo PT3H.'),
  priceTotal: z.coerce.number().positive('Debe ser mayor que cero.').multipleOf(0.01, 'Máximo dos decimales.'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Código ISO 4217, por ejemplo USD.'),
  productType: z.enum(['SINGLE_TICKET', 'GUIDED_TOUR', 'PACKAGE']),
  categories: z.string().trim().min(1, 'Indica al menos una categoría.'),
  badges: z.string().optional(),
  includes: z.string().optional(),
  supportedLanguages: z.string().optional(),
  photos: z.string().optional(),
  address: z.string().trim().min(1, 'Indica la dirección.').max(300),
  city: z.string().trim().min(1, 'Indica la ciudad.').max(120),
  country: z.string().trim().regex(/^[A-Z]{2}$/, 'Código ISO 3166-1, por ejemplo EC.'),
  freeCancellation: z.boolean(),
});
export type AttractionFormValues = z.infer<typeof attractionFormSchema>;

/** "a, b , c" → ["a","b","c"] */
export const splitList = (value?: string) =>
  (value ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
