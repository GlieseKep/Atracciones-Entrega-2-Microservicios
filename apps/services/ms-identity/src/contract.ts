/** Tipos del contrato `Plan/ms_identity/ms_identity-openapi.yaml`. */
export const ROLES = ['ADMIN', 'OPERADOR', 'CLIENTE', 'GUIA'] as const;
export type RolNombre = (typeof ROLES)[number];

export interface RolDto {
  id: number;
  nombre: RolNombre;
  descripcion: string;
}

export interface RegistroRequest {
  correo: string;
  password: string;
  nombre: string;
  apellido: string;
  documento: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
}

/** Solo trae los campos enviados: los demás conservan su valor. */
export interface PerfilUpdateRequest {
  nombre?: string;
  apellido?: string;
  documento?: string | null;
  telefono?: string | null;
  fecha_nacimiento?: string | null;
  avatar?: string | null;
}

export interface UsuarioDto {
  id: number;
  correo: string;
  nombre: string;
  apellido: string;
  documento: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  avatar: string | null;
  verificado: boolean;
  activo: boolean;
  roles: RolNombre[];
  ultimo_acceso: string | null;
  creado_en: string;
  actualizado_en: string;
}

export interface UsuarioResumenDto {
  id: number;
  nombre: string;
  apellido: string;
  correo: string;
  activo: boolean;
}

export interface PaginationMetadata {
  total_results: number;
  page: number;
  limit: number;
  total_pages: number;
  next_cursor?: string | null;
}

export interface UsuarioPageDto {
  metadata: PaginationMetadata;
  data: UsuarioDto[];
}

export interface SesionResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  usuario: UsuarioDto;
}

export interface PrincipalDto {
  tipo: 'USUARIO' | 'CLIENTE_API';
  id: number;
  nombre: string;
  roles: RolNombre[];
}

export interface ClienteApiDto {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
  creado_en: string;
  ultimo_uso: string | null;
}

export interface ClienteApiCreadoDto extends ClienteApiDto {
  /** Se muestra una sola vez. */
  api_key: string;
}

/** Turista que registra un socio (`cliente_api` con `cla_tipo = 'TURISTA'`). `client_id` es `cla_id` como texto. */
export interface ClienteDto {
  client_id: string;
  nombre: string;
  email: string;
  identificacion: string;
  telefono: string | null;
}

export interface ClienteRequest {
  nombre: string;
  email: string;
  identificacion: string;
  telefono: string | null;
}

export interface ClienteFiltros {
  email: string | null;
  identificacion: string | null;
}
