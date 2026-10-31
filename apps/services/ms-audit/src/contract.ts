/** Tipos del contrato `Plan/ms_audit/ms_audit-openapi.yaml`. */
export interface EntradaBitacora {
  id: number;
  event_id: string;
  usu_id: number | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  correlation_id: string | null;
  detalle: Record<string, unknown> | null;
  ip: string | null;
  creado_en: string;
}

export interface BitacoraPage {
  metadata: { total_results: number; page: number; limit: number; total_pages: number };
  data: EntradaBitacora[];
}

export interface BitacoraFilters {
  accion: string | null;
  entidad: string | null;
  entidadId: string | null;
  correlationId: string | null;
  usuId: number | null;
  desde: string | null;
  hasta: string | null;
  page: number;
  limit: number;
}

/** Fila que se guarda por cada evento. */
export interface AuditRecord {
  eventId: string;
  usuId: number | null;
  accion: string;
  entidad: string;
  entidadId: string | null;
  correlationId: string | null;
  detalle: Record<string, unknown> | null;
  creadoEn: Date;
}
