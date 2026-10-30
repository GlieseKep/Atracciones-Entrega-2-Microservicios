/** Tipos del contrato `Plan/ms_review/ms_review-openapi.yaml`. */

/** `ResenaRequest` validado. */
export interface ResenaInput {
  puntuacion: number;
  limpieza: number;
  servicio: number;
  calidad_precio: number;
  puntualidad: number;
  comentario: string;
}

export interface ResenaDto extends ResenaInput {
  id: number;
  atr_id: number;
  autor_nombre: string;
  anonima: boolean;
  visible: boolean;
  creado_en: string;
}

export interface PaginationMetadata {
  total_results: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface ResenaPage {
  data: ResenaDto[];
  pagination: PaginationMetadata;
}

/** Datos del evento `RESENA_PUBLICADA`: promedios ya calculados, solo sobre reseñas visibles. */
export interface ResenaPublicada {
  atr_id: number;
  ren_id: number;
  promedio: number;
  limpieza: number;
  servicio: number;
  calidad_precio: number;
  puntualidad: number;
  numero_resenas: number;
}
