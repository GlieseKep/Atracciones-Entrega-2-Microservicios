import { AppError, errorFields, PROBLEM_CONTENT_TYPE, toProblem, type InvalidParam, type Logger } from '@atracciones/platform';
import type { ErrorRequestHandler, Request } from 'express';
import type { ContractStatuses } from './contract';

/** Error tal como lo produce express-openapi-validator. */
interface ValidatorError {
  status: number;
  message: string;
  errors?: { path: string; message: string; errorCode?: string }[];
}

const isValidatorError = (error: unknown): error is ValidatorError =>
  typeof error === 'object' && error !== null && typeof (error as ValidatorError).status === 'number' && Array.isArray((error as ValidatorError).errors);

/** `/body/customer/phone` → `customer.phone`; `/query/date` → `date`; `/headers/idempotency-key` → `Idempotency-Key`. */
function paramName(path: string): string {
  const [, location, ...rest] = path.split('/');
  const name = rest.join('.');
  if (location === 'headers') return name.replace(/(^|-)([a-z])/g, (_m, dash: string, c: string) => `${dash}${c.toUpperCase()}`);
  return name || location || path;
}

/** Mensajes del validador (ajv, en inglés) traducidos para `invalid_params[].reason`. */
function reason(error: { message: string; errorCode?: string }): string {
  const kind = error.errorCode?.split('.')[0];
  const quoted = /'([^']+)'/.exec(error.message)?.[1];
  switch (kind) {
    case 'required':
      return 'Es obligatorio.';
    case 'type':
      return `Tipo de dato inválido (${error.message.replace(/^must be /, 'debe ser ')}).`;
    case 'format':
      return `Formato inválido: ${error.message.replace(/^must match format /, 'se espera ')}.`;
    case 'enum':
      return `Valor no permitido: ${error.message.replace(/^must be equal to one of the allowed values:?\s*/, 'debe ser uno de ')}.`.replace(/\.\.$/, '.');
    case 'minimum':
    case 'maximum':
    case 'minLength':
    case 'maxLength':
    case 'pattern':
      return `Valor fuera de las reglas del contrato (${error.message}).`;
    case 'additionalProperties':
      return `Propiedad no definida en el contrato${quoted ? `: ${quoted}` : ''}.`;
    default:
      return error.message;
  }
}

/** Convierte un error del validador en el error de aplicación equivalente (formato del contrato). */
export function fromValidatorError(error: ValidatorError, logger: Logger): AppError {
  const invalid: InvalidParam[] = (error.errors ?? []).map((e) => ({ name: paramName(e.path), reason: reason(e) }));
  switch (error.status) {
    case 400: {
      const idempotency = invalid.some((p) => p.name === 'Idempotency-Key');
      return AppError.validation(
        idempotency ? 'La cabecera Idempotency-Key es obligatoria y debe ser un UUID.' : 'La solicitud no cumple el contrato.',
        invalid,
        idempotency ? 'MISSING_IDEMPOTENCY_KEY' : 'VALIDATION_ERROR',
      );
    }
    case 401:
      return AppError.unauthorized();
    case 403:
      return AppError.forbidden('Las credenciales no permiten esta operación.');
    case 404:
      return AppError.notFound('La ruta solicitada no existe en el contrato atracciones-openapi-v2.');
    case 405:
      return new AppError(405, 'METHOD_NOT_ALLOWED', 'El método no está definido en el contrato para esta ruta.');
    case 415:
      return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo debe enviarse como application/json.');
    default:
      // 500 del validador = la respuesta generada no cumple el contrato: es un defecto nuestro, se registra completo.
      logger.error('respuesta fuera del contrato', { detalle: error.message, errores: error.errors });
      return AppError.internal();
  }
}

/** Manejador final: ProblemDetails del contrato con el código HTTP ajustado a los documentados en la operación. */
export function contractErrorHandler(statuses: ContractStatuses, logger: Logger): ErrorRequestHandler {
  return (error, req: Request & { openapi?: { openApiRoute?: string } }, res, _next) => {
    let appError: unknown = isValidatorError(error) ? fromValidatorError(error, logger) : error;
    if (!(appError instanceof AppError) && typeof error?.status === 'number' && error.type === 'entity.parse.failed') {
      appError = AppError.validation('El cuerpo no es un JSON válido.');
    }
    if (!(appError instanceof AppError)) logger.error('error no controlado', { method: req.method, path: req.originalUrl, ...errorFields(error) });

    const instance = req.originalUrl.split('?')[0];
    const problem = toProblem(appError, instance);
    const route = req.openapi?.openApiRoute;
    const status = route ? statuses.normalize(req.method, route, problem.status) : problem.status;
    if (status !== problem.status) {
      // El código cambia para respetar el contrato; el `code` original se conserva para diagnóstico.
      const normalized = toProblem(new AppError(status, problem.code ?? 'ERROR', problem.detail), instance);
      Object.assign(problem, { status, title: normalized.title });
    }
    if (res.headersSent) return;
    res.status(status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  };
}
