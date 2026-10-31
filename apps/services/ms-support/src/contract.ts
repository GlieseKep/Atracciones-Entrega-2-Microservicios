/** Tipos del contrato `Plan/ms_support/ms_support-openapi.yaml`. */
export interface MensajeInput {
  nombre: string;
  correo: string;
  asunto: string;
  cuerpo: string;
}

export interface MensajeDto extends MensajeInput {
  id: number;
  leido: boolean;
  creado_en: string;
}

export interface MensajePage {
  data: MensajeDto[];
  pagination: { total_results: number; page: number; limit: number; total_pages: number };
}
