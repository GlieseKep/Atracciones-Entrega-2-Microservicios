import type { ProblemDetails } from '@/types/api';

/** Categorías de error que la interfaz sabe explicar (plan §11). */
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

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code?: string;
  /** Errores de validación por campo, ya en texto amigable. */
  readonly fieldErrors: Record<string, string[]>;
  readonly traceId?: string;

  constructor(kind: ApiErrorKind, status: number, problem: ProblemDetails = {}) {
    super(friendlyMessage(kind, problem.code));
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = problem.code;
    this.traceId = problem.traceId;
    this.fieldErrors = problem.errors ?? {};
  }
}

const AVAILABILITY_CODES = new Set(['INSUFFICIENT_AVAILABILITY', 'SLOT_UNAVAILABLE', 'ORDER_HOLD_EXPIRED']);
const PAYMENT_CODES = new Set(['PAYMENT_ATTEMPTS_EXCEEDED', 'ORDER_NOT_PAYABLE', 'AMOUNT_MISMATCH']);
const IDEMPOTENCY_CODES = new Set(['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS']);

/** Clasifica una respuesta HTTP fallida a partir del estado y del `code` RFC 7807. */
export function classifyProblem(status: number, problem: ProblemDetails = {}, hadToken = false): ApiErrorKind {
  const code = problem.code ?? '';
  if (IDEMPOTENCY_CODES.has(code)) return 'idempotency';
  if (AVAILABILITY_CODES.has(code)) return 'availability';
  if (PAYMENT_CODES.has(code)) return 'payment';
  switch (status) {
    case 400:
      return 'validation';
    case 401:
      return hadToken ? 'sessionExpired' : 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'notFound';
    case 409:
      return 'conflict';
    case 422:
      return 'payment';
    case 429:
      return 'rateLimit';
    default:
      return status >= 500 ? 'server' : 'conflict';
  }
}

const SPECIFIC: Record<string, string> = {
  INSUFFICIENT_AVAILABILITY: 'Ya no quedan suficientes plazas para ese horario. Prueba con otra hora o menos entradas.',
  SLOT_UNAVAILABLE: 'Ese horario ya no está disponible. Elige otra fecha u hora.',
  ORDER_HOLD_EXPIRED: 'La reserva temporal de plazas expiró. Vuelve a iniciar la compra.',
  PAYMENT_ATTEMPTS_EXCEEDED: 'Se alcanzó el número máximo de intentos de pago para este pedido.',
  ORDER_NOT_PAYABLE: 'Este pedido ya no admite pagos.',
  AMOUNT_MISMATCH: 'El importe no coincide con el calculado por el servidor. Actualiza el resumen e inténtalo de nuevo.',
  IDEMPOTENCY_KEY_REUSED: 'Esta operación ya se envió con otros datos. Revisa el resumen e inténtalo como una operación nueva.',
  IDEMPOTENCY_IN_PROGRESS: 'Tu solicitud anterior todavía se está procesando. Espera unos segundos.',
  INVALID_STATE_TRANSITION: 'La operación no está permitida en el estado actual.',
  RESERVATION_ALREADY_STARTED: 'La actividad ya comenzó y no se puede cancelar.',
  RESERVATION_MANAGED_BY_ORDER: 'Esta reserva pertenece a un pedido: cancélala desde el pedido.',
  PROFILE_NOT_REGISTERED: 'Completa tu perfil antes de continuar.',
  PROFILE_INCOMPLETE: 'Completa tus datos de facturación antes de continuar.',
  USER_INACTIVE: 'Tu cuenta está desactivada. Contacta con soporte.',
  CONCURRENCY_CONFLICT: 'Otra persona modificó este recurso al mismo tiempo. Vuelve a intentarlo.',
  ATTRACTION_HAS_ACTIVE_RESERVATIONS: 'La atracción tiene reservas activas y no se puede eliminar.',
};

const GENERIC: Record<ApiErrorKind, string> = {
  network: 'No pudimos conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.',
  sessionExpired: 'Tu sesión expiró. Inicia sesión de nuevo para continuar.',
  unauthenticated: 'Necesitas iniciar sesión para continuar.',
  forbidden: 'No tienes permiso para realizar esta acción.',
  notFound: 'No encontramos lo que buscabas.',
  availability: 'No hay disponibilidad suficiente para la selección.',
  payment: 'El pago simulado fue rechazado. Puedes intentarlo con otro método.',
  idempotency: 'Esta operación ya fue enviada.',
  conflict: 'No se pudo completar la operación por un conflicto con el estado actual.',
  validation: 'Algunos datos no son válidos. Revisa el formulario.',
  rateLimit: 'Demasiadas solicitudes seguidas. Espera un momento.',
  server: 'Ocurrió un problema en el servidor. Inténtalo más tarde.',
};

/** Mensaje amigable sin detalles internos (ni `detail`, ni trazas). */
export function friendlyMessage(kind: ApiErrorKind, code?: string): string {
  return (code && SPECIFIC[code]) || GENERIC[kind];
}

/** Convierte cualquier error en texto apto para la interfaz. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return GENERIC.server;
}

export function isApiError(error: unknown, ...kinds: ApiErrorKind[]): error is ApiError {
  return error instanceof ApiError && (kinds.length === 0 || kinds.includes(error.kind));
}
