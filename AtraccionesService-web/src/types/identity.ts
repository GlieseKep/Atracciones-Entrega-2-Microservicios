import type { IsoDate, IsoDateTime } from './api';

/** Cuentas y sesión de ms-identity (`/api/v3/auth/**` y GraphQL `identity*`). */

export type RoleName = 'ADMIN' | 'OPERADOR' | 'CLIENTE' | 'GUIA';

export interface User {
  id: number;
  correo: string;
  nombre: string;
  apellido: string;
  documento: string | null;
  telefono: string | null;
  fecha_nacimiento: IsoDate | null;
  avatar: string | null;
  verificado: boolean;
  activo: boolean;
  roles: RoleName[];
  ultimo_acceso: IsoDateTime | null;
  creado_en: IsoDateTime;
  actualizado_en: IsoDateTime;
}

export interface SessionResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  usuario: User;
}

export interface RegisterRequest {
  correo: string;
  password: string;
  nombre: string;
  apellido: string;
  documento?: string | null;
  telefono?: string | null;
  fecha_nacimiento?: IsoDate | null;
}

/** Solo se envían los campos que cambian. */
export interface ProfileUpdate {
  nombre?: string;
  apellido?: string;
  documento?: string | null;
  telefono?: string | null;
  fecha_nacimiento?: IsoDate | null;
}
