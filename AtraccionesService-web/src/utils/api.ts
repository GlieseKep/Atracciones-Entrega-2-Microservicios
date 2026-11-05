import type { InvalidParam } from '@/types/api';

/** Categorías de error que la interfaz sabe explicar. */
export type ApiErrorKind =
  | 'network'
  | 'sessionExpired'
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'availability'
  | 'payment'
  | 'idempotency'
  | 'conflict'
  | 'validation'
  | 'rateLimit'
  | 'server';

/** Lo que llega del servidor: ProblemDetails (REST) o `errors[].extensions` (GraphQL), ya normalizado. */
export interface ErrorInfo {
  code?: string;
  detail?: string;
  invalidParams?: InvalidParam[];
  correlationId?: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code?: string;
  /** Errores por campo (`invalid_params`), con el nombre del campo tal como lo envía el servicio. */
  readonly fieldErrors: Record<string, string[]>;
  readonly correlationId?: string;

  constructor(kind: ApiErrorKind, status: number, info: ErrorInfo = {}) {
    super(friendlyMessage(kind, info.code, status < 500 ? info.detail : undefined));
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = info.code;
    this.correlationId = info.correlationId;
    this.fieldErrors = {};
    for (const param of info.invalidParams ?? []) (this.fieldErrors[param.name] ??= []).push(param.reason);
  }
}

const AVAILABILITY_CODES = new Set(['OUT_OF_STOCK', 'SLOT_TIME_MISMATCH', 'SLOT_MISMATCH', 'SLOT_NOT_FOUND', 'DATE_IN_PAST', 'DATE_BLOCKED']);
const PAYMENT_CODES = new Set(['PAYMENT_REJECTED', 'PAYMENT_FAILED', 'PAYMENT_DECLINED', 'INVALID_CARD']);
const IDEMPOTENCY_CODES = new Set(['IDEMPOTENCY_KEY_MISMATCH', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS']);

/** Clasifica un error a partir del estado HTTP y del código del servicio. */
export function classifyError(status: number, code = '', hadToken = false): ApiErrorKind {
  if (IDEMPOTENCY_CODES.has(code)) return 'idempotency';
  if (AVAILABILITY_CODES.has(code)) return 'availability';
  if (PAYMENT_CODES.has(code)) return 'payment';
  switch (status) {
    case 400:
    case 422:
      return 'validation';
    case 401:
      return hadToken && code !== 'INVALID_CREDENTIALS' ? 'sessionExpired' : 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'notFound';
    case 409:
      return 'conflict';
    case 429:
      return 'rateLimit';
    default:
      return status >= 500 || status === 0 ? 'server' : 'conflict';
  }
}

/** Mensajes propios para los códigos de los servicios; el resto usa el `detail` del servicio o el genérico. */
const SPECIFIC: Record<string, string> = {
  OUT_OF_STOCK: 'Ya no quedan suficientes cupos para ese horario. Prueba con otra hora o menos boletos.',
  SLOT_TIME_MISMATCH: 'El horario elegido no coincide con la fecha. Vuelve a elegir el horario.',
  SLOT_MISMATCH: 'El horario elegido no coincide con la fecha. Vuelve a elegir el horario.',
  DATE_IN_PAST: 'La fecha de la actividad ya pasó. Elige otra fecha.',
  ALIAS_CONFLICT: 'La solicitud tiene datos repetidos con valores distintos.',
  ATTRACTION_NOT_FOUND: 'Esta experiencia ya no está disponible.',
  INVALID_CUSTOMER: 'Revisa los datos del titular: nombre completo, correo, teléfono y documento.',
  INVALID_TICKET_COUNT: 'Debe haber al menos un boleto de adulto.',
  INVALID_CREDENTIALS: 'El correo o la contraseña son incorrectos.',
  INVALID_REFRESH_TOKEN: 'Tu sesión expiró. Inicia sesión de nuevo para continuar.',
  ACCOUNT_DISABLED: 'Tu cuenta está desactivada. Escríbenos desde el centro de ayuda.',
  INVALID_CURRENT_PASSWORD: 'La contraseña actual no es correcta.',
  INVALID_TOKEN: 'El enlace no es válido o ya venció. Solicita uno nuevo.',
  IDEMPOTENCY_KEY_MISMATCH: 'Esta operación ya se envió con otros datos. Revisa el resumen e inténtalo de nuevo.',
  IDEMPOTENCY_IN_PROGRESS: 'Tu solicitud anterior todavía se está procesando. Espera unos segundos.',
  RATE_LIMITED: 'Demasiadas solicitudes seguidas. Espera un momento.',
  CANCELLATION_DEADLINE_PASSED: 'Ya pasó el plazo de cancelación gratuita de esta reserva. Escríbenos desde el centro de ayuda.',
  REVIEW_ALREADY_EXISTS: 'Ya publicaste una opinión sobre esta experiencia.',
  INVOICE_NOT_FOUND: 'La factura de este pedido todavía no se ha emitido.',
};

const GENERIC: Record<ApiErrorKind, string> = {
  network: 'No pudimos conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.',
  sessionExpired: 'Tu sesión expiró. Inicia sesión de nuevo para continuar.',
  unauthenticated: 'Necesitas iniciar sesión para continuar.',
  forbidden: 'No tienes permiso para realizar esta acción.',
  notFound: 'No encontramos lo que buscabas.',
  availability: 'No hay disponibilidad suficiente para la selección.',
  payment: 'El pago fue rechazado. Puedes intentarlo con otro método.',
  idempotency: 'Esta operación ya fue enviada.',
  conflict: 'No se pudo completar la operación por un conflicto con el estado actual.',
  validation: 'Algunos datos no son válidos. Revisa el formulario.',
  rateLimit: 'Demasiadas solicitudes seguidas. Espera un momento.',
  server: 'Ocurrió un problema en el servidor. Inténtalo más tarde.',
};

/** Mensaje amigable: el del código conocido, el `detail` de un error de negocio (4xx) o el genérico. Nunca trazas. */
export function friendlyMessage(kind: ApiErrorKind, code?: string, detail?: string): string {
  if (code && SPECIFIC[code]) return SPECIFIC[code];
  if (detail && kind !== 'sessionExpired' && kind !== 'network') return detail;
  return GENERIC[kind];
}

/** Convierte cualquier error en texto apto para la interfaz. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return GENERIC.server;
}

export function isApiError(error: unknown, ...kinds: ApiErrorKind[]): error is ApiError {
  return error instanceof ApiError && (kinds.length === 0 || kinds.includes(error.kind));
}

/** Primer error del campo `name` (o de un campo anidado como `customer.email`). */
export function fieldError(error: unknown, ...names: string[]): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  for (const name of names) if (error.fieldErrors[name]?.[0]) return error.fieldErrors[name][0];
  return undefined;
}
