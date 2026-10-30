import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { AppError, currentCorrelationId, type InvalidParam } from '@atracciones/platform';

/** Códigos de GraphQL para los estados HTTP más comunes (los clientes los usan para decidir qué mostrar). */
const GRAPHQL_CODES: Record<number, string> = {
  400: 'BAD_USER_INPUT',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'BAD_USER_INPUT',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Error de GraphQL a partir de un error de negocio o técnico. `extensions` lleva el código del servicio
 * (`OUT_OF_STOCK`, `INVALID_DOCUMENT`…), el estado HTTP equivalente, los parámetros inválidos y el `correlation_id`.
 */
export function toGraphqlError(error: unknown): GraphQLError {
  if (error instanceof GraphQLError) return error;
  const app = error instanceof AppError ? error : AppError.internal();
  return new GraphQLError(app.status >= 500 && !(error instanceof AppError) ? 'Ocurrió un error inesperado.' : app.message, {
    extensions: {
      code: GRAPHQL_CODES[app.status] ?? (app.status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST'),
      reason: app.code,
      status: app.status,
      ...(app.invalidParams?.length ? { invalidParams: app.invalidParams } : {}),
      correlationId: currentCorrelationId(),
    },
  });
}

/** Error de entrada del cliente (400) con los campos inválidos. */
export const badInput = (message: string, invalidParams: InvalidParam[] = [], reason = 'VALIDATION_ERROR') =>
  toGraphqlError(AppError.validation(message, invalidParams, reason));

/** Respuesta de error final: sin trazas internas, con el código y el correlation_id. */
export function formatError(formatted: GraphQLFormattedError, error: unknown): GraphQLFormattedError {
  const original = (error as { originalError?: unknown })?.originalError;
  if (original && !(original instanceof GraphQLError)) return toGraphqlError(original).toJSON();
  const { stacktrace: _stacktrace, ...extensions } = formatted.extensions ?? {};
  return { ...formatted, extensions: { ...extensions, correlationId: extensions.correlationId ?? currentCorrelationId() } };
}
