import { currentCorrelationId } from './correlation';

/** Formato de error del contrato (`components.schemas.ProblemDetails`, RFC 7807). */
export interface InvalidParam {
  name: string;
  reason: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  correlation_id?: string;
  timestamp?: string;
  invalid_params?: InvalidParam[];
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Título por código (los del contrato tal como aparecen en sus ejemplos) y por estado HTTP. */
const TITLES_BY_CODE: Record<string, string> = {
  OUT_OF_STOCK: 'Cupos Agotados para el Turno Solicitado',
  UNAUTHORIZED: 'No Autorizado',
  FORBIDDEN: 'Acceso Prohibido',
  INSUFFICIENT_SCOPE: 'Acceso Prohibido',
  RESERVATION_NOT_CANCELLABLE: 'Cancelación No Permitida',
  CANCELLATION_DEADLINE_PASSED: 'Cancelación Fuera de Plazo',
};
const TITLES_BY_STATUS: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No Autorizado',
  403: 'Acceso Prohibido',
  404: 'Recurso no encontrado',
  405: 'Método no permitido',
  409: 'Conflicto con el estado actual',
  415: 'Tipo de contenido no soportado',
  422: 'Entidad no procesable',
  500: 'Error interno del servidor',
  503: 'Servicio no disponible',
};
/** `type` del contrato para códigos con un nombre propio en su ejemplo. */
const SLUGS: Record<string, string> = { OUT_OF_STOCK: 'sin-cupos' };

/** Error de aplicación con estado HTTP y código estable; cruza servicios (HTTP y gRPC) sin perder información. */
export class AppError extends Error {
  readonly title: string;
  readonly invalidParams: InvalidParam[] | undefined;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options: { title?: string; invalidParams?: InvalidParam[] } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.title = options.title ?? TITLES_BY_CODE[code] ?? TITLES_BY_STATUS[status] ?? 'Error';
    this.invalidParams = options.invalidParams?.length ? options.invalidParams : undefined;
  }

  static validation(message: string, invalidParams?: InvalidParam[], code = 'VALIDATION_ERROR') {
    return new AppError(400, code, message, { invalidParams });
  }
  static unauthorized(message = 'Se requiere un token JWT válido o una X-API-Key válida.') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message: string, code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }
  static notFound(message: string, code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }
  static conflict(code: string, message: string) {
    return new AppError(409, code, message);
  }
  static unprocessable(code: string, message: string, invalidParams?: InvalidParam[]) {
    return new AppError(422, code, message, { invalidParams });
  }
  static unavailable(message = 'Un servicio interno no está disponible. Reintente más tarde.') {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }
  static internal(message = 'Se produjo un error inesperado.') {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}

export const problemTypeBase = () => (process.env.PROBLEM_TYPE_BASE_URL ?? 'https://booking.epn.edu.ec/errors/').replace(/\/?$/, '/');

const slug = (code: string) => SLUGS[code] ?? code.toLowerCase().replace(/_/g, '-');

/** `type` del ProblemDetails para un código (`OUT_OF_STOCK` → `https://booking.epn.edu.ec/errors/sin-cupos`). */
export const problemType = (code: string) => `${problemTypeBase()}${slug(code)}`;

/** Título estándar de un estado HTTP (para cuando la Partner API ajusta el código a los documentados). */
export const statusTitle = (status: number) => TITLES_BY_STATUS[status] ?? 'Error';

/** Convierte cualquier error en ProblemDetails. Los errores no controlados nunca exponen detalles internos. */
export function toProblem(error: unknown, instance?: string): ProblemDetails {
  const e = error instanceof AppError ? error : AppError.internal();
  const correlationId = currentCorrelationId();
  return {
    type: `${problemTypeBase()}${slug(e.code)}`,
    title: e.title,
    status: e.status,
    detail: e.message,
    ...(instance ? { instance } : {}),
    code: e.code,
    ...(correlationId ? { correlation_id: correlationId } : {}),
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...(e.invalidParams ? { invalid_params: e.invalidParams } : {}),
  };
}

/** Reconstruye el error a partir del ProblemDetails recibido de otro componente (conserva estado, código y detalle). */
export function fromProblem(body: unknown, status: number): AppError {
  const p = (body && typeof body === 'object' ? body : {}) as Partial<ProblemDetails>;
  return new AppError(
    typeof p.status === 'number' ? p.status : status,
    typeof p.code === 'string' ? p.code : status >= 500 ? 'INTERNAL_ERROR' : 'ERROR',
    typeof p.detail === 'string' ? p.detail : 'Error en un servicio interno.',
    { title: typeof p.title === 'string' ? p.title : undefined, invalidParams: Array.isArray(p.invalid_params) ? p.invalid_params : undefined },
  );
}
