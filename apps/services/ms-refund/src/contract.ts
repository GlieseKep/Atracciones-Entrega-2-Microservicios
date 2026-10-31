/** Tipos del contrato `Plan/ms_refund/ms_refund-openapi.yaml`. */
export interface ReembolsoInput {
  ord_id: number;
  /** Sin valor, todo el saldo. */
  monto: number | null;
  motivo: string | null;
}

export interface ReembolsoDto {
  reembolso_id: string;
  pag_id: number;
  ord_id?: number;
  monto_reembolsado: number;
  monto_acumulado?: number;
  motivo: string | null;
  referencia: string | null;
  solicitado_en: string;
  procesado_en: string;
}

export interface ReembolsoPage {
  data: ReembolsoDto[];
  pagination: { total_results: number; page: number; limit: number; total_pages: number };
}
