/** Tipos compartidos del contrato HTTP (AtraccionesService.Contracts/Common). JSON en camelCase. */

/** Fecha local `YYYY-MM-DD` (DateOnly). */
export type IsoDate = string;
/** Instante ISO 8601 con zona (DateTimeOffset). */
export type IsoDateTime = string;

export interface Price {
  currency: string;
  total: number;
}

export interface PagedResponse<T> {
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
  totalPages: number;
  data: T[];
}

/** Cuerpo RFC 7807 que devuelve el API (incluye `code` y `traceId` como extensiones). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
}
