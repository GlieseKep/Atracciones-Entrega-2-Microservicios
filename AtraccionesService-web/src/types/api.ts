/** Tipos compartidos del Gateway: contrato v3 (REST) y servicios del portal (GraphQL). JSON en snake_case. */

/** Fecha local `YYYY-MM-DD`. */
export type IsoDate = string;
/** Instante ISO 8601 con zona. */
export type IsoDateTime = string;

export interface InvalidParam {
  name: string;
  reason: string;
}

/** ProblemDetails (RFC 7807) del Gateway y de la Partner API. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  correlation_id?: string;
  timestamp?: string;
  invalid_params?: InvalidParam[];
}

/** Error de GraphQL: el código del servicio va en `extensions.reason`. */
export interface GraphqlError {
  message: string;
  extensions?: {
    code?: string;
    reason?: string;
    status?: number;
    invalidParams?: InvalidParam[];
    correlationId?: string;
  };
}

export interface PaginationMetadata {
  total_results: number;
  page: number;
  limit: number;
  total_pages: number;
  next_cursor?: string | null;
}
