/** Tipos del contrato `Plan/ms_catalog/ms_catalog-openapi.yaml`. Las respuestas públicas son las del contrato v3. */
export const SORTS = ['PRICE_ASC', 'PRICE_DESC', 'RATING_DESC', 'POPULARITY'] as const;
export type Sort = (typeof SORTS)[number];

export const ATTRACTION_TYPES = ['GUIDED_TOUR', 'ADMISSION', 'DAY_TRIP', 'TRANSPORT', 'PACKAGE'] as const;
export type AttractionType = (typeof ATTRACTION_TYPES)[number];

export const ATTRACTION_STATES = ['BORRADOR', 'PUBLICADA', 'INACTIVA'] as const;
export type AttractionState = (typeof ATTRACTION_STATES)[number];

export const INCLUSION_TYPES = ['INCLUYE', 'NO_INCLUYE', 'RECOMENDACION'] as const;
export type InclusionType = (typeof INCLUSION_TYPES)[number];

export const OPERATOR_CHARGES = ['ADMIN', 'VENDEDOR', 'GUIA'] as const;
export type OperatorCharge = (typeof OPERATOR_CHARGES)[number];

export interface CategoryTreeNode {
  id: string;
  nombre: string;
  slug: string;
  descripcion?: string;
  icono: string;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
  orden: number;
  subcategorias: CategoryTreeNode[];
}

export interface CategoryFlat {
  id: string;
  padre_id: string | null;
  nombre: string;
  slug: string;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
}

export interface PaginationMetadata {
  total_results: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface GuiaDto {
  /** ID del guía: Inventory lo guarda en horarios y turnos. */
  gui_id: number;
  codigo: string;
  nombre: string;
  credencial_mintur: string;
  operador: string;
  usu_id: number | null;
  activo: boolean;
}

export interface ProveedorInfo {
  id: string;
  nombre_comercial: string;
  ruc?: string;
  telefono_emergencia?: string;
  email_soporte?: string;
}

export interface OperadorDto extends ProveedorInfo {
  direccion: string | null;
  prov_id: number;
  activo: boolean;
}

export interface InclusionDto {
  id: number;
  tipo: InclusionType;
  nombre: string;
  orden: number;
  /** Atracciones no eliminadas que la usan: con alguna, no se puede quitar. */
  atracciones: number;
}

export interface IdiomaAdminDto {
  codigo: string;
  nombre: string;
  atracciones: number;
}

/** Categoría del panel: también las inactivas, con lo que hace falta para editarla. */
export interface CategoriaAdminDto extends CategoryFlat {
  descripcion: string | null;
  icono: string;
  orden: number;
  activa: boolean;
  atracciones: number;
}

export interface OperadorUsuarioDto {
  usu_id: number;
  cargo: OperatorCharge;
  nombre: string;
  correo: string;
}

export interface LogisticaReserva {
  atraccion_id: string;
  nombre: string;
  punto_encuentro: string;
  free_cancellation: boolean;
  deadline_hours: number;
  guia: { gui_id: number; nombre: string } | null;
}

export interface ReferenciaAtraccion {
  atr_id: number;
  id: string;
  slug: string;
  nombre: string;
}

export interface ItineraryStopInput {
  numero: number;
  hora: string;
  titulo: string;
  descripcion: string | null;
  duracionMinutos: number;
  ubicacion: string | null;
}

/** `AtraccionRequest` validado. */
export interface AttractionInput {
  nombre: string;
  slug: string | null;
  descripcion: string;
  descripcionCorta: string | null;
  tipo: AttractionType;
  latitud: number;
  longitud: number;
  direccion: string | null;
  puntoEncuentro: string | null;
  instruccionesLlegada: string | null;
  duracionHoras: number;
  ciuId: number;
  operador: string;
  categorias: string[];
  idiomas: string[];
  inclusiones: number[];
  fotos: { url: string; alt: string; orden: number }[];
  itinerario: ItineraryStopInput[];
  incluyeComida: boolean;
  incluyeTransporte: boolean;
  incluyeGuia: boolean;
  accesibleSillaRuedas: boolean;
  accesibleCarriola: boolean;
  admiteAnimalesAsistencia: boolean;
  cancelacionGratuita: boolean;
  horasCancelacion: number;
  politicaCancelacion: string | null;
  permitePaquete: boolean;
  porcentajeDescuentoPaquete: number;
  destacada: boolean;
}
