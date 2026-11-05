import type { IsoDateTime, PaginationMetadata } from './api';

/** Reseñas de ms-review. Las puntuaciones van de 1 a 10. */

export interface ReviewInput {
  puntuacion: number;
  limpieza: number;
  servicio: number;
  calidad_precio: number;
  puntualidad: number;
  comentario: string;
}

export interface Review extends ReviewInput {
  id: number;
  autor_nombre: string;
  anonima: boolean;
  creado_en: IsoDateTime;
}

export interface ReviewPage {
  data: Review[];
  pagination: PaginationMetadata;
}
